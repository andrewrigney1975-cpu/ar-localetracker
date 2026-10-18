// Voice announcements (splits, time-based, goal-based): when to speak and what to say.
// On Android the same logic runs natively in TrackingService (VoiceCoach.java) so it keeps
// talking with the screen off; this copy drives the browser simulator and is the reference
// for the shared fixture (tests/voice.test.js ↔ VoiceCoachTest.java). Keep them in step.

const KM = 1000;
const MILE = 1609.344;
/** Below this distance an average pace is meaningless, so it isn't spoken. */
const MIN_AVG_DISTANCE_M = 50;

export const GOAL_STEPS = { walk: 1, run: 1, cycle: 5, ski: 5 };
export const INTERVAL_OPTIONS = [5, 10, 15, 30];
/** Countdown: metres to go at which it speaks, over the last kilometre to the goal. */
export const COUNTDOWN_M = [1000, 500, 200, 100];
/** Routines at least this long also get 33% and 66% goal milestones. */
export const THIRDS_MIN_GOAL_M = 10000;
/**
 * Goal milestones as [numerator, denominator, percent, mask bit], in order. Bits 1–4 are the
 * quarters (the saved goalMask predates the thirds), 5–6 the thirds for long routines.
 */
const QUARTERS = [[1, 4, 25, 1], [1, 2, 50, 2], [3, 4, 75, 3], [1, 1, 100, 4]];
const WITH_THIRDS = [[1, 4, 25, 1], [1, 3, 33, 5], [1, 2, 50, 2], [2, 3, 66, 6], [3, 4, 75, 3], [1, 1, 100, 4]];

/**
 * Announcement settings for one activity, from the app settings object. Goal mode 'set' uses
 * the distance chosen on the start screen; 'auto' starts with no goal until the routine
 * predictor sets one (setGoal).
 */
export function voiceConfig(s, activity) {
  const v = s.voice;
  const mode = v.goalMode[activity] ?? 'off';
  return {
    splits: Boolean(v.splits[activity]),
    time: Boolean(v.time[activity]),
    goal: mode === 'set',
    intervalMin: v.intervalMin,
    goalM: mode === 'set' ? v.goalM[activity] : 0,
    pace: (s.liveSpeedMode?.[activity] ?? 'pace') === 'pace',
    imperial: s.units === 'imperial',
    autoGoal: mode === 'auto',
    confirmGoal: v.confirmGoal !== false,
    watchBuzz: v.watchBuzz !== false,
    // The setting; the tracker turns it on only for a workout recognised as a routine.
    countdown: Boolean(v.countdown),
    // Set by setGoal for a workout recognised as a routine (thirds, time to go).
    routine: false,
  };
}

/**
 * A routine's own announcement settings ({splits, time, goal, intervalMin}, from Settings →
 * Learned routines → Customise), or null to keep the activity's.
 */
export function routineVoice(s, routineId) {
  return (routineId && s.voice.routines?.[routineId]) || null;
}

export class VoiceCoach {
  constructor(cfg) {
    this.cfg = cfg;
    this.unit = cfg.imperial ? MILE : KM;
    this.splitsDone = 0;
    this.lastSplitMs = 0;
    this.intervalsDone = 0;
    this.goalMask = 0;
    /** How many of COUNTDOWN_M have been passed. */
    this.countdownDone = 0;
    this.goalPaused = false;
    /** Kind of the last announcement (for the watch buzz): goal-reached | goal | countdown | split | time. */
    this.lastKind = null;
  }

  get enabled() {
    return this.cfg.splits || this.cfg.time || (this.cfg.goal && this.cfg.goalM > 0) || Boolean(this.cfg.autoGoal);
  }

  /**
   * Set (or replace) the goal mid-workout; milestones already passed are not announced.
   * routine: the workout was recognised as a routine.
   */
  setGoal(goalM, distanceM, routine = false) {
    this.cfg = { ...this.cfg, goal: true, goalM, routine };
    this.goalMask = goalMaskAt(this.cfg, distanceM);
    this.countdownDone = countdownPassed(goalM, distanceM);
  }

  /**
   * Switch to a recognised routine's own settings (routineVoice). Intervals already passed at
   * the new length are not announced.
   */
  applyRoutine(o, elapsedMs) {
    this.cfg = { ...this.cfg, splits: Boolean(o.splits), time: Boolean(o.time), goal: Boolean(o.goal), intervalMin: o.intervalMin > 0 ? o.intervalMin : this.cfg.intervalMin };
    this.intervalsDone = Math.floor(elapsedMs / (this.cfg.intervalMin * 60000));
  }

  /** Stop goal milestones (e.g. the user left their usual route); other kinds carry on. */
  pauseGoal() {
    this.goalPaused = true;
  }

  /** Mark everything already passed as announced (e.g. resuming without saved state). */
  syncTo(distanceM, elapsedMs) {
    this.splitsDone = Math.floor(distanceM / this.unit);
    // Estimate when the last split was passed from the average pace so far.
    this.lastSplitMs = distanceM > 0 ? Math.round(elapsedMs * ((this.splitsDone * this.unit) / distanceM)) : 0;
    this.intervalsDone = this.cfg.intervalMin > 0 ? Math.floor(elapsedMs / (this.cfg.intervalMin * 60000)) : 0;
    this.goalMask = goalMaskAt(this.cfg, distanceM);
    this.countdownDone = countdownPassed(this.cfg.goalM, distanceM);
  }

  /** Called while recording with the running totals. Returns the text to speak, or null. */
  onProgress(distanceM, elapsedMs) {
    const { cfg, unit } = this;
    const parts = [];
    let saidDistance = false;
    const kinds = new Set();

    const k = Math.floor(distanceM / unit);
    if (k > this.splitsDone) {
      if (cfg.splits) {
        parts.push(`${spokenDistance(k * unit, cfg.imperial)}. Split time ${spokenDuration((elapsedMs - this.lastSplitMs) / (k - this.splitsDone))}.`);
        saidDistance = true;
        kinds.add('split');
      }
      this.splitsDone = k;
      this.lastSplitMs = elapsedMs;
    }

    if (cfg.intervalMin > 0) {
      const intervalMs = cfg.intervalMin * 60000;
      const j = Math.floor(elapsedMs / intervalMs);
      if (j > this.intervalsDone) {
        if (cfg.time) {
          // Always the workout's distance so far, even when a split (a round number) was just said.
          parts.push(`${capitalise(spokenDuration(j * intervalMs))}. Distance ${spokenDistance(distanceM, cfg.imperial)}.`);
          saidDistance = true;
          kinds.add('time');
        }
        this.intervalsDone = j;
      }
    }

    if (cfg.goalM > 0) {
      let reached = 0;
      for (const [num, den, pct, b] of milestones(cfg)) {
        const bit = 1 << b;
        if (!(this.goalMask & bit) && distanceM >= (cfg.goalM * num) / den) {
          this.goalMask |= bit;
          reached = pct;
        }
      }
      if (reached && cfg.goal && !this.goalPaused) {
        const goal = `${spokenNumber(cfg.goalM / unit)} ${cfg.imperial ? 'mile' : 'kilometre'} goal`;
        kinds.add(reached === 100 ? 'goal-reached' : 'goal');
        if (reached === 100) parts.push(`Goal reached: ${goal}, in ${spokenDuration(elapsedMs)}.`);
        else {
          const head = reached === 50 ? `Halfway to your ${goal}.` : `${reached} percent of your ${goal}.`;
          parts.push(saidDistance ? head : `${head} ${spokenDistance(distanceM, cfg.imperial)}.`);
        }
      }

      // Countdown over the last kilometre; when several pass at once only the nearest is said,
      // and none once the goal itself is reached.
      const c = countdownPassed(cfg.goalM, distanceM);
      if (c > this.countdownDone) {
        if (cfg.countdown && cfg.goal && !this.goalPaused && distanceM < cfg.goalM) {
          parts.push(`${COUNTDOWN_M[c - 1]} metres to go.`);
          kinds.add('countdown');
        }
        this.countdownDone = c;
      }
    }

    this.lastKind = ['goal-reached', 'goal', 'countdown', 'split', 'time'].find((k) => kinds.has(k)) ?? null;
    if (!parts.length) return null;
    // A countdown on its own stays short: no average.
    const onlyCountdown = kinds.size === 1 && kinds.has('countdown');
    if (!onlyCountdown && distanceM >= MIN_AVG_DISTANCE_M && elapsedMs > 0) {
      // A routine's percent milestone says the time left at the average pace instead.
      if (cfg.routine && kinds.has('goal')) parts.push(spokenTimeToGo(((cfg.goalM - distanceM) * elapsedMs) / distanceM));
      else parts.push(spokenAverage(distanceM, elapsedMs, cfg));
    }
    return parts.join(' ');
  }
}

/** The goal milestones for this config: quarters, plus thirds for a routine of 10 km or more. */
function milestones(cfg) {
  return cfg.routine && cfg.goalM >= THIRDS_MIN_GOAL_M ? WITH_THIRDS : QUARTERS;
}

/** goalMask with every milestone passed at this distance (0 without a goal). */
function goalMaskAt(cfg, distanceM) {
  let mask = 0;
  if (cfg.goalM > 0) for (const [num, den, , b] of milestones(cfg)) if (distanceM >= (cfg.goalM * num) / den) mask |= 1 << b;
  return mask;
}

/** How many of COUNTDOWN_M are passed at this distance (0 without a goal). */
function countdownPassed(goalM, distanceM) {
  if (!(goalM > 0)) return 0;
  let n = 0;
  while (n < COUNTDOWN_M.length && goalM - distanceM <= COUNTDOWN_M[n]) n++;
  return n;
}

/**
 * Spoken once when a goal is chosen: "Goal 4.7 kilometres, your usual Saturday morning loop."
 * source: 'route' | 'time' | 'manual'.
 */
export function goalConfirmation(goalM, imperial, source, name) {
  const unit = imperial ? MILE : KM;
  const v = spokenNumber(goalM / unit);
  const words = `${v} ${imperial ? (v === '1' ? 'mile' : 'miles') : v === '1' ? 'kilometre' : 'kilometres'}`;
  if (source === 'route' && name) return `Goal ${words}, your usual ${name}.`;
  if (source === 'time' && name) return `Goal ${words}, based on your ${name}.`;
  return `Goal ${words}.`;
}

/** Said once when the user leaves the routine's route. */
export const OFF_ROUTE_PHRASE = 'Off your usual route. Goal announcements paused.';

/** "Average pace 6 minutes 18 seconds per kilometre." or "Average speed 24.3 kilometres per hour." */
export function spokenAverage(distanceM, elapsedMs, { pace, imperial }) {
  const unit = imperial ? MILE : KM;
  if (pace) {
    const perUnitMs = Math.round(elapsedMs / (distanceM / unit) / 1000) * 1000;
    return `Average pace ${spokenDuration(perUnitMs)} per ${imperial ? 'mile' : 'kilometre'}.`;
  }
  const perHour = distanceM / unit / (elapsedMs / 3600000);
  const v = Math.round(perHour * 10) / 10;
  return `Average speed ${spokenNumber(v)} ${imperial ? 'miles' : 'kilometres'} per hour.`;
}

/** "1 hour and 3 minutes to go", "31 minutes to go": to the minute, at least 1. */
export function spokenTimeToGo(ms) {
  const total = Math.max(1, Math.round(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  const part = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const words = h && m ? `${part(h, 'hour')} and ${part(m, 'minute')}` : h ? part(h, 'hour') : part(m, 'minute');
  return `${words} to go.`;
}

/** "5 kilometres", "1 kilometre", "3.25 miles". */
export function spokenDistance(m, imperial) {
  // Floor, so 0.999 km isn't announced as 1; the epsilon keeps 5 × 1609.344 / 1609.344 at 5.
  const v = Math.floor((m / (imperial ? MILE : KM)) * 100 + 1e-6) / 100;
  const word = imperial ? 'mile' : 'kilometre';
  return `${spokenNumber(v)} ${v === 1 ? word : word + 's'}`;
}

/** "1 hour 3 minutes 5 seconds"; zero parts are left out. */
export function spokenDuration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const part = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const out = [];
  if (h) out.push(part(h, 'hour'));
  if (m) out.push(part(m, 'minute'));
  if (s || !out.length) out.push(part(s, 'second'));
  return out.join(' ');
}

/** Up to two decimals, trailing zeros dropped: 10, 1.5, 3.25. */
export function spokenNumber(v) {
  return String(Math.round(v * 100) / 100);
}

const capitalise = (s) => s[0].toUpperCase() + s.slice(1);

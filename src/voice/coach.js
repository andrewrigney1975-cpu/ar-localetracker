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
  };
}

export class VoiceCoach {
  constructor(cfg) {
    this.cfg = cfg;
    this.unit = cfg.imperial ? MILE : KM;
    this.splitsDone = 0;
    this.lastSplitMs = 0;
    this.intervalsDone = 0;
    this.goalMask = 0;
    this.goalPaused = false;
    /** Kind of the last announcement (for the watch buzz): goal-reached | goal | split | time. */
    this.lastKind = null;
  }

  get enabled() {
    return this.cfg.splits || this.cfg.time || (this.cfg.goal && this.cfg.goalM > 0) || Boolean(this.cfg.autoGoal);
  }

  /** Set (or replace) the goal mid-workout; milestones already passed are not announced. */
  setGoal(goalM, distanceM) {
    this.cfg = { ...this.cfg, goal: true, goalM };
    this.goalMask = 0;
    for (let q = 1; q <= 4; q++) if (distanceM >= (goalM * q) / 4) this.goalMask |= 1 << q;
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
    this.goalMask = 0;
    if (this.cfg.goalM > 0) for (let q = 1; q <= 4; q++) if (distanceM >= (this.cfg.goalM * q) / 4) this.goalMask |= 1 << q;
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
          parts.push(`${capitalise(spokenDuration(j * intervalMs))}.${saidDistance ? '' : ` Distance ${spokenDistance(distanceM, cfg.imperial)}.`}`);
          saidDistance = true;
          kinds.add('time');
        }
        this.intervalsDone = j;
      }
    }

    if (cfg.goalM > 0) {
      let reached = 0;
      for (let q = 1; q <= 4; q++) {
        const bit = 1 << q;
        if (!(this.goalMask & bit) && distanceM >= (cfg.goalM * q) / 4) {
          this.goalMask |= bit;
          reached = q;
        }
      }
      if (reached && cfg.goal && !this.goalPaused) {
        const goal = `${spokenNumber(cfg.goalM / unit)} ${cfg.imperial ? 'mile' : 'kilometre'} goal`;
        kinds.add(reached === 4 ? 'goal-reached' : 'goal');
        if (reached === 4) parts.push(`Goal reached: ${goal}, in ${spokenDuration(elapsedMs)}.`);
        else {
          const head = reached === 2 ? `Halfway to your ${goal}.` : `${reached * 25} percent of your ${goal}.`;
          parts.push(saidDistance ? head : `${head} ${spokenDistance(distanceM, cfg.imperial)}.`);
        }
      }
    }

    this.lastKind = ['goal-reached', 'goal', 'split', 'time'].find((k) => kinds.has(k)) ?? null;
    if (!parts.length) return null;
    if (distanceM >= MIN_AVG_DISTANCE_M && elapsedMs > 0) parts.push(spokenAverage(distanceM, elapsedMs, cfg));
    return parts.join(' ');
  }
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

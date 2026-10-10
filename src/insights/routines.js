// Learn workout routines from history and predict the goal distance for a new workout
// (docs/plans/goal-prediction.md). buildRoutineModel() runs in JS whenever the workout list
// changes; predictGoal() is also ported to Java (RoutineMatcher.java) so TrackingService can
// decide for watch- and widget-started workouts. tests/routines.test.js writes a shared
// fixture that RoutineMatcherTest replays; keep predictGoal() and the Java port in step.

import { makeProjection } from '../geo/geo.js';

export const MODEL_VERSION = 1;
const DAY_MS = 86400000;
const KM = 1000;
const MILE = 1609.344;

/** Tunables (checked with scripts/evaluate-goals.mjs). */
export const T = {
  minDistanceM: 500,
  minDurationS: 180,
  signaturePoints: 32,
  sameStartM: 300,
  distanceTolerance: 0.12,
  routeTolMinM: 120,
  routeTolFraction: 0.04,
  loopM: 200,
  halfLifeDays: 60,
  activityWindowDays: 180,
  activityMinWorkouts: 5,
  routineMinCount: 3,
  routineMinRecent: 2,
  routineRecentDays: 60,
  routineMaxCv: 0.12,
  bucketMinCount: 4,
  bucketMaxCv: 0.1,
  timeSigmaMin: 75,
  minTimeMatch: 0.25,
  minShare: 0.7,
  minMargin: 0.3,
  roundSnap: 0.03,
  hitTolerance: 0.1,
  minPredictionsForFeedback: 3,
  feedbackWindow: 5,
  staleDays: 14,
  minHitRate: 0.5,
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PLURAL = { walk: 'walks', run: 'runs', cycle: 'rides', ski: 'ski days' };

// ---- Local time ------------------------------------------------------------------------------

/** Local weekday (0 = Sunday) and minute of day; tzOffset as from getTimezoneOffset(). */
export function localTime(ms, tzOffset) {
  const d = new Date(ms - tzOffset * 60000);
  return { weekday: d.getUTCDay(), minute: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

const isWeekend = (wd) => wd === 0 || wd === 6;

/** 0 night, 1 morning, 2 midday, 3 afternoon, 4 evening. */
export function dayPart(minute) {
  if (minute < 300 || minute >= 1260) return 0;
  if (minute < 660) return 1;
  if (minute < 900) return 2;
  if (minute < 1080) return 3;
  return 4;
}
const PART_NAMES = ['night', 'morning', 'midday', 'afternoon', 'evening'];

const circDiff = (a, b) => {
  const d = Math.abs(a - b) % 1440;
  return d > 720 ? 1440 - d : d;
};

function circularMeanMinute(minutes) {
  let sx = 0;
  let sy = 0;
  for (const m of minutes) {
    const a = (m / 1440) * 2 * Math.PI;
    sx += Math.cos(a);
    sy += Math.sin(a);
  }
  let a = Math.atan2(sy, sx);
  if (a < 0) a += 2 * Math.PI;
  return Math.round((a / (2 * Math.PI)) * 1440) % 1440;
}

// ---- Geometry --------------------------------------------------------------------------------

const metres = (lat1, lon1, lat2, lon2) => {
  const p = makeProjection(lat1, lon1);
  const [x, y] = p.toXY(lat2, lon2);
  return Math.hypot(x, y);
};

/** Resample a [lon, lat] polyline to `k` points evenly spaced by distance, as [lat, lon]. */
export function resample(preview, k = T.signaturePoints) {
  if (preview.length === 0) return [];
  const p = makeProjection(preview[0][1], preview[0][0]);
  const xy = preview.map(([lon, lat]) => p.toXY(lat, lon));
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  const total = cum[cum.length - 1];
  const out = [];
  let j = 0;
  for (let s = 0; s < k; s++) {
    const target = k === 1 ? 0 : (total * s) / (k - 1);
    while (j < xy.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j];
    const f = j + 1 < xy.length && seg > 0 ? Math.min(1, Math.max(0, (target - cum[j]) / seg)) : 0;
    const a = preview[j];
    const b = preview[Math.min(j + 1, preview.length - 1)];
    out.push([round6(a[1] + (b[1] - a[1]) * f), round6(a[0] + (b[0] - a[0]) * f)]);
  }
  return out;
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

function pointSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Distance in metres from a point to a [lat, lon] polyline. */
export function distanceToPolyline(lat, lon, line) {
  if (!line.length) return Infinity;
  const p = makeProjection(line[0][0], line[0][1]);
  const xy = line.map(([la, lo]) => p.toXY(la, lo));
  const [px, py] = p.toXY(lat, lon);
  if (xy.length === 1) return Math.hypot(px - xy[0][0], py - xy[0][1]);
  let best = Infinity;
  for (let i = 1; i < xy.length; i++) best = Math.min(best, pointSegment(px, py, xy[i - 1][0], xy[i - 1][1], xy[i][0], xy[i][1]));
  return best;
}

function meanClosest(a, b) {
  let sum = 0;
  for (const [x, y] of a) {
    let best = Infinity;
    for (let i = 1; i < b.length; i++) best = Math.min(best, pointSegment(x, y, b[i - 1][0], b[i - 1][1], b[i][0], b[i][1]));
    sum += best;
  }
  return sum / a.length;
}

/** Symmetric mean closest-point distance between two signatures (either direction of B). */
export function routeDistance(sigA, sigB) {
  const p = makeProjection(sigA[0][0], sigA[0][1]);
  const a = sigA.map(([la, lo]) => p.toXY(la, lo));
  const b = sigB.map(([la, lo]) => p.toXY(la, lo));
  // Point-to-segment in both directions makes a reversed B score the same as B, so a
  // loop run the other way round is the same route.
  return (meanClosest(a, b) + meanClosest(b, a)) / 2;
}

// ---- Features --------------------------------------------------------------------------------

export function isUsable(w, excluded = new Set()) {
  return (
    !String(w.id).startsWith('sample-') &&
    !excluded.has(w.id) &&
    (w.summary?.distance ?? 0) >= T.minDistanceM &&
    (w.summary?.duration ?? 0) >= T.minDurationS &&
    Array.isArray(w.preview) &&
    w.preview.length >= 2
  );
}

export function features(w) {
  const { weekday, minute } = localTime(w.startedAt, w.tzOffset ?? 0);
  const first = w.preview[0];
  const last = w.preview[w.preview.length - 1];
  // A loop ends where it started and goes round: an out-and-back also ends at the start but
  // reaches about half its length away (a circle about a third).
  let farthest = 0;
  for (const [lon, lat] of w.preview) farthest = Math.max(farthest, metres(first[1], first[0], lat, lon));
  return {
    id: w.id,
    activity: w.activity,
    at: w.startedAt,
    weekday,
    minute,
    start: [first[1], first[0]],
    loop: metres(first[1], first[0], last[1], last[0]) <= T.loopM && farthest <= 0.4 * w.summary.distance,
    signature: resample(w.preview),
    distance: w.summary.distance,
    duration: w.summary.duration,
    prediction: w.prediction ?? null,
  };
}

export function sameRoute(a, b) {
  if (metres(a.start[0], a.start[1], b.start[0], b.start[1]) > T.sameStartM) return Infinity;
  const ratio = Math.abs(a.distance - b.distance) / Math.max(a.distance, b.distance);
  if (ratio > T.distanceTolerance) return Infinity;
  const d = routeDistance(a.signature, b.signature);
  const tol = Math.max(T.routeTolMinM, T.routeTolFraction * Math.max(a.distance, b.distance));
  return d <= tol ? d : Infinity;
}

// ---- Model -----------------------------------------------------------------------------------

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
};
const cv = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return mean > 0 ? sd / mean : 0;
};

/**
 * Goal in metres for one unit system: the median rounded to 0.1, or to a whole number when
 * the history clusters around one (e.g. 4.9–5.1 km → 5 km).
 */
export function goalFor(distances, imperial) {
  const unit = imperial ? MILE : KM;
  const med = median(distances) / unit;
  const whole = Math.round(med);
  const lo = quantile(distances, 0.25) / unit - 0.05;
  const hi = quantile(distances, 0.75) / unit + 0.05;
  const value = whole > 0 && Math.abs(whole - med) <= T.roundSnap * med && whole >= lo && whole <= hi ? whole : Math.round(med * 10) / 10;
  return Math.round(value * unit * 10) / 10;
}

function clusterRoutes(fs) {
  let clusters = [];
  const assign = (f, list) => {
    let best = null;
    let bestD = Infinity;
    for (const c of list) {
      const d = sameRoute(f, c.medoid);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };
  for (const f of fs) {
    const c = assign(f, clusters);
    if (c) c.members.push(f);
    else clusters.push({ medoid: f, members: [f] });
  }
  const medoidOf = (members) => {
    if (members.length <= 2) return members[0];
    let best = members[0];
    let bestSum = Infinity;
    for (const m of members) {
      let sum = 0;
      for (const o of members) if (o !== m) sum += routeDistance(m.signature, o.signature);
      if (sum < bestSum) {
        bestSum = sum;
        best = m;
      }
    }
    return best;
  };
  // One reassignment pass against the settled medoids.
  const medoids = clusters.map((c) => ({ medoid: medoidOf(c.members), members: [] }));
  for (const f of fs) {
    const c = assign(f, medoids);
    if (c) c.members.push(f);
    else medoids.push({ medoid: f, members: [f] });
  }
  clusters = medoids.filter((c) => c.members.length);
  return clusters;
}

function routineName(members, loop) {
  const days = new Array(7).fill(0);
  for (const m of members) days[m.weekday]++;
  const top = days.indexOf(Math.max(...days));
  const weekend = members.filter((m) => isWeekend(m.weekday)).length / members.length;
  const dayLabel = days[top] / members.length >= 0.6 ? WEEKDAYS[top] : weekend >= 0.75 ? 'weekend' : weekend <= 0.25 ? 'weekday' : '';
  const part = PART_NAMES[dayPart(circularMeanMinute(members.map((m) => m.minute)))];
  return [dayLabel, part, loop ? 'loop' : 'route'].filter(Boolean).join(' ');
}

/** Auto goals predicted for this routine and how many landed within ±10%: all, and recent. */
function hitStats(fs, routineId) {
  const outcomes = [];
  for (const f of fs) {
    const p = f.prediction;
    if (!p || p.source !== 'route' || p.routineId !== routineId) continue;
    outcomes.push(Math.abs(f.distance - p.goalM) / p.goalM <= T.hitTolerance);
  }
  const recent = outcomes.slice(-T.feedbackWindow);
  return {
    predictions: outcomes.length,
    hits: outcomes.filter(Boolean).length,
    recentPredictions: recent.length,
    recentHits: recent.filter(Boolean).length,
  };
}

/**
 * @param {object[]} workouts  stored workout records
 * @param {{now?: number, excluded?: string[], names?: Record<string,string>}} [opts]
 */
export function buildRoutineModel(workouts, { now = Date.now(), excluded = [], names = {} } = {}) {
  const ex = new Set(excluded);
  const all = workouts
    .filter((w) => isUsable(w, ex) && w.startedAt <= now)
    .sort((a, b) => a.startedAt - b.startedAt || String(a.id).localeCompare(String(b.id)))
    .map(features);
  const weight = (f) => Math.pow(0.5, (now - f.at) / DAY_MS / T.halfLifeDays);
  const activities = {};
  for (const act of [...new Set(all.map((f) => f.activity))].sort()) {
    const fs = all.filter((f) => f.activity === act);
    const recentWindow = fs.filter((f) => now - f.at <= T.activityWindowDays * DAY_MS);
    const routines = [];
    const inRoutine = new Set();
    for (const c of clusterRoutes(fs)) {
      const ms = c.members;
      const id = ms[0].id;
      const dists = ms.map((m) => m.distance);
      const loop = ms.filter((m) => m.loop).length * 2 >= ms.length;
      const recent = ms.filter((m) => now - m.at <= T.routineRecentDays * DAY_MS).length;
      const { predictions, hits, recentPredictions, recentHits } = hitStats(fs, id);
      // Feedback: a routine whose recent auto goals mostly missed stops predicting (habits change).
      const suppressed = recentPredictions >= T.minPredictionsForFeedback && recentHits / recentPredictions < T.minHitRate;
      const r = {
        id,
        name: names[id] || routineName(ms, loop),
        count: ms.length,
        weight: round4(ms.reduce((s, m) => s + weight(m), 0)),
        lastAt: ms[ms.length - 1].at,
        medianM: Math.round(median(dists) * 10) / 10,
        cv: round4(cv(dists)),
        goal: { metric: goalFor(dists, false), imperial: goalFor(dists, true) },
        medianS: Math.round(median(ms.map((m) => m.duration))),
        startMin: circularMeanMinute(ms.map((m) => m.minute)),
        weekdays: [0, 1, 2, 3, 4, 5, 6].map((d) => ms.filter((m) => m.weekday === d).length),
        start: c.medoid.start,
        signature: c.medoid.signature, // dropped below unless eligible (keeps the model small)
        loop,
        predictions,
        hits,
        suppressed,
        workoutIds: ms.map((m) => m.id),
      };
      r.eligible = !suppressed && r.count >= T.routineMinCount && recent >= T.routineMinRecent && r.cv <= T.routineMaxCv;
      // Members of eligible routines are explained, and so are those of a suppressed routine
      // the user has stopped doing (a stale habit). A suppressed routine that is still being
      // done sometimes is a coin flip against another one, so it keeps competing as "others".
      const stale = suppressed && now - r.lastAt > T.staleDays * DAY_MS;
      if (r.eligible || stale) ms.forEach((m) => inRoutine.add(m.id));
      if (!r.eligible) delete r.signature;
      routines.push(r);
    }
    // Workouts outside any eligible routine compete with routines that start nearby.
    const others = fs.filter((f) => !inRoutine.has(f.id)).map((f) => [f.start[0], f.start[1], round4(weight(f)), f.minute, f.weekday]);
    const buckets = [];
    for (const dayType of [0, 1]) {
      for (let part = 0; part < 5; part++) {
        const ms = recentWindow.filter((f) => (isWeekend(f.weekday) ? 1 : 0) === dayType && dayPart(f.minute) === part);
        if (!ms.length) continue;
        const dists = ms.map((m) => m.distance);
        const b = {
          dayType,
          part,
          name: `${dayType ? 'weekend' : 'weekday'} ${PART_NAMES[part]} ${PLURAL[act] ?? 'workouts'}`,
          count: ms.length,
          medianM: Math.round(median(dists) * 10) / 10,
          cv: round4(cv(dists)),
          goal: { metric: goalFor(dists, false), imperial: goalFor(dists, true) },
        };
        b.eligible = b.count >= T.bucketMinCount && b.cv <= T.bucketMaxCv;
        buckets.push(b);
      }
    }
    activities[act] = {
      usable: recentWindow.length,
      ready: recentWindow.length >= T.activityMinWorkouts,
      routines: routines.sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id)),
      others,
      buckets,
    };
  }
  return { v: MODEL_VERSION, builtAt: now, need: T.activityMinWorkouts, activities };
}

const round4 = (v) => Math.round(v * 1e4) / 1e4;

// ---- Prediction (ported to RoutineMatcher.java) ----------------------------------------------

/**
 * @param {object} model  from buildRoutineModel
 * @param {{activity:string, now:number, tzOffset:number, lat?:number, lon?:number, imperial?:boolean}} ctx
 *   lat/lon NaN or missing when there is no good fix yet (time-only fallback).
 * @returns {{goalM:number, source:'route'|'time', routineId:string|null, name:string, confidence:number, signature?:number[][]}
 *   | {goalM:null, reason:'learning'|'unsure', have?:number, need?:number}}
 */
export function predictGoal(model, ctx) {
  const a = model?.activities?.[ctx.activity];
  const need = model?.need ?? T.activityMinWorkouts;
  if (!a || !a.ready) return { goalM: null, reason: 'learning', have: a ? a.usable : 0, need };
  const { weekday, minute } = localTime(ctx.now, ctx.tzOffset);
  const units = ctx.imperial ? 'imperial' : 'metric';
  const timeMatch = (m) => Math.exp(-0.5 * (circDiff(minute, m) / T.timeSigmaMin) ** 2);
  const dayFactor = (sameDay, sameType) => (sameDay ? 1 : sameType ? 0.6 : 0.3);
  const hasFix = Number.isFinite(ctx.lat) && Number.isFinite(ctx.lon);

  if (hasFix) {
    let total = 0;
    let best = null;
    let bestScore = 0;
    let secondScore = 0;
    let othersScore = 0;
    for (const r of a.routines) {
      if (!r.eligible || metres(ctx.lat, ctx.lon, r.start[0], r.start[1]) > T.sameStartM) continue;
      const tm = timeMatch(r.startMin);
      const sameType = r.weekdays.some((n, d) => n > 0 && isWeekend(d) === isWeekend(weekday));
      const s = r.weight * tm * dayFactor(r.weekdays[weekday] > 0, sameType);
      total += s;
      if (s > bestScore) {
        secondScore = bestScore;
        bestScore = s;
        best = { r, tm };
      } else if (s > secondScore) secondScore = s;
    }
    if (best) {
      for (const [lat, lon, w, m, wd] of a.others) {
        if (metres(ctx.lat, ctx.lon, lat, lon) > T.sameStartM) continue;
        const s = w * timeMatch(m) * dayFactor(wd === weekday, isWeekend(wd) === isWeekend(weekday));
        total += s;
        othersScore += s;
      }
      // Unexplained workouts from here compete as one group (they may be a routine forming).
      const share = bestScore / total;
      const margin = (bestScore - Math.max(secondScore, othersScore)) / total;
      if (best.tm >= T.minTimeMatch && share >= T.minShare && margin >= T.minMargin) {
        return {
          goalM: best.r.goal[units],
          source: 'route',
          routineId: best.r.id,
          name: best.r.name,
          confidence: round4(share),
          signature: best.r.signature,
        };
      }
    }
  }

  // Time-only fallback only without a fix: at a known place with no matching routine, or a
  // new place, the user is doing something else.
  if (hasFix) return { goalM: null, reason: 'unsure' };
  const b = a.buckets.find((x) => x.eligible && x.dayType === (isWeekend(weekday) ? 1 : 0) && x.part === dayPart(minute));
  if (b) return { goalM: b.goal[units], source: 'time', routineId: null, name: b.name, confidence: round4(1 - b.cv) };
  return { goalM: null, reason: 'unsure' };
}

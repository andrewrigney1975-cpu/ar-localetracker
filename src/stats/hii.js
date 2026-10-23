// How a workout's high-intensity interval plans went: time, distance and speed in each mode,
// and where each bout falls along the route (for the elevation chart). Pure, so it is tested.

import { HII_MODES } from '../hii/plan.js';

/**
 * Wall-clock time (ms) of `sec` seconds of active time, from the workout's active intervals
 * ([[startMs, endMs], …]); past the end it stays at the end.
 */
export function activeToWall(activeIntervals, sec) {
  let left = sec * 1000;
  for (const [a, b] of activeIntervals) {
    if (left <= b - a) return a + left;
    left -= b - a;
  }
  const last = activeIntervals[activeIntervals.length - 1];
  return last ? last[1] : 0;
}

/** Cumulative distance at wall time `t`, interpolated between track points. */
export function distanceAt(track, t) {
  const n = track.n;
  if (!n || t <= track.t[0]) return 0;
  if (t >= track.t[n - 1]) return track.dist[n - 1];
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (track.t[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = track.t[hi] - track.t[lo];
  const f = span > 0 ? (t - track.t[lo]) / span : 0;
  return track.dist[lo] + (track.dist[hi] - track.dist[lo]) * f;
}

/**
 * Each bout as run: up to the plan's stop and the workout's end.
 * @returns {{mode:string, fromS:number, toS:number, fromM:number, toM:number}[]} fromS/toS in active seconds
 */
export function boutsRun(plans, track, activeIntervals) {
  const activeS = activeIntervals.reduce((s, [a, b]) => s + (b - a), 0) / 1000;
  const out = [];
  for (const plan of plans ?? []) {
    const end = Math.min(plan.atS + (plan.stopS != null ? Math.min(plan.durationS, plan.stopS - plan.atS) : plan.durationS), activeS);
    for (const [mode, s, d] of plan.items) {
      const fromS = plan.atS + s;
      const toS = Math.min(fromS + d, end);
      if (toS <= fromS) continue;
      out.push({ mode, fromS, toS, fromM: distanceAt(track, activeToWall(activeIntervals, fromS)), toM: distanceAt(track, activeToWall(activeIntervals, toS)) });
    }
  }
  return out;
}

/**
 * Totals per mode, in mode order, for modes that were run: bouts, seconds, metres and the
 * average speed (m/s).
 */
export function intervalTotals(bouts) {
  const out = [];
  for (const mode of HII_MODES) {
    const mine = bouts.filter((b) => b.mode === mode);
    if (!mine.length) continue;
    const seconds = mine.reduce((s, b) => s + b.toS - b.fromS, 0);
    const metres = mine.reduce((s, b) => s + b.toM - b.fromM, 0);
    out.push({ mode, bouts: mine.length, seconds, metres, speed: seconds > 0 ? metres / seconds : 0 });
  }
  return out;
}

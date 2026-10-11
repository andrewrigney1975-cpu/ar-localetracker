// Personal bests for Insights: best average pace (or speed), best split, fastest speed and
// longest workout, per activity. Split times need the full track, so the fastest kilometre
// and mile of each workout are cached in localStorage by workout version; a cold cache
// loads each track once (like effort.js).

import { getTrack } from '../db/workouts.js';
import { computeSplits } from '../stats/summary.js';
import { M_PER_MI } from '../units.js';

const KEY = 'insights.splits.v1';

/** Best average pace only counts workouts at least this long (a 300 m dash isn't a best). */
export const MIN_AVG_DISTANCE_M = 1000;

/** Ski days include lifts, so their pace and splits mean nothing. */
const SPLIT_ACTIVITIES = new Set(['walk', 'run', 'cycle']);

let cache = null;

function load() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    cache = {};
  }
  return cache;
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache));
  } catch {
    // Storage full or blocked: the cache just lives for this session.
  }
}

const versionKey = (w) => `${w.activity}|${w.updatedAt ?? w.createdAt ?? 0}`;

/** Fastest full split in seconds, or null when the track has none. */
export function fastestSplit(track, splitLen) {
  let best = null;
  for (const sp of computeSplits(track, splitLen, false)) {
    if (!sp.partial && sp.time > 0 && (best == null || sp.time < best)) best = sp.time;
  }
  return best;
}

/**
 * Fastest kilometre and mile of each workout, loading tracks only for those not cached.
 * @returns {Promise<Map<string, {km:number|null, mi:number|null}>>}
 */
export async function splitTimesFor(workouts, { onProgress, isCancelled } = {}) {
  const c = load();
  const out = new Map();
  const todo = [];
  for (const w of workouts) {
    if (!SPLIT_ACTIVITIES.has(w.activity) || (w.summary?.distance ?? 0) < 1000) continue;
    const hit = c[w.id];
    if (hit && hit.v === versionKey(w)) out.set(w.id, { km: hit.km, mi: hit.mi });
    else todo.push(w);
  }
  let done = 0;
  for (const w of todo) {
    if (isCancelled?.()) break;
    onProgress?.(done, todo.length);
    let km = null;
    let mi = null;
    try {
      const track = await getTrack(w.id);
      if (track) {
        km = fastestSplit(track, 1000);
        mi = fastestSplit(track, M_PER_MI);
      }
    } catch (e) {
      console.warn('Insights: no track for', w.id, e);
    }
    c[w.id] = { v: versionKey(w), km, mi };
    out.set(w.id, { km, mi });
    done++;
    if (done % 20 === 0) persist();
  }
  if (todo.length) persist();
  onProgress?.(todo.length, todo.length);
  return out;
}

/** Drop cache entries for workouts that no longer exist. */
export function pruneSplitCache(ids) {
  const c = load();
  const keep = new Set(ids);
  let changed = false;
  for (const id of Object.keys(c)) {
    if (!keep.has(id)) {
      delete c[id];
      changed = true;
    }
  }
  if (changed) persist();
}

const avgSpeedOf = (s) => s.avgMovingSpeed || (s.movingTime > 0 ? s.distance / s.movingTime : s.duration > 0 ? s.distance / s.duration : 0);

/**
 * Bests per activity. Each best is {id, startedAt, value} (or null): avgSpeed and maxSpeed
 * in m/s, split in seconds for one km or mile (`units`), longest in metres.
 * @param {object[]} workouts
 * @param {Map<string, {km:number|null, mi:number|null}>} [splitTimes]  from splitTimesFor
 * @param {'metric'|'imperial'} [units]
 * @returns {{activity:string, count:number, avgSpeed:object|null, split:object|null, maxSpeed:object|null, longest:object|null}[]}
 */
export function personalBests(workouts, splitTimes = new Map(), units = 'metric') {
  const byActivity = new Map();
  for (const w of workouts) {
    const s = w.summary ?? {};
    let b = byActivity.get(w.activity);
    if (!b) byActivity.set(w.activity, (b = { activity: w.activity, count: 0, avgSpeed: null, split: null, maxSpeed: null, longest: null }));
    b.count++;
    const consider = (key, value, better) => {
      if (value == null || !Number.isFinite(value) || value <= 0) return;
      if (!b[key] || better(value, b[key].value)) b[key] = { id: w.id, startedAt: w.startedAt, value };
    };
    const more = (a, c) => a > c;
    consider('longest', s.distance, more);
    consider('maxSpeed', s.maxSpeed, more);
    if (SPLIT_ACTIVITIES.has(w.activity)) {
      if ((s.distance ?? 0) >= MIN_AVG_DISTANCE_M) consider('avgSpeed', avgSpeedOf(s), more);
      const t = splitTimes.get(w.id);
      consider('split', units === 'imperial' ? t?.mi : t?.km, (a, c) => a < c);
    }
  }
  return [...byActivity.values()];
}

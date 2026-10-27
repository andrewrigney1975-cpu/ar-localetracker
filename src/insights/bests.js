// Personal bests for Insights: best average pace (or speed), best split, fastest speed and
// longest workout, per activity. Splits and fastest speed need the full track, so each
// workout's fastest kilometre, mile and sustained speed are cached in localStorage by
// workout version; a cold cache loads each track once (like effort.js).

import { getTrack } from '../db/workouts.js';
import { computeSplits, sustainedSpeed } from '../stats/summary.js';
import { M_PER_MI } from '../units.js';

const KEY = 'insights.splits.v2';

/** Best average pace only counts workouts at least this long (a 300 m dash isn't a best). */
export const MIN_AVG_DISTANCE_M = 1000;

/**
 * Fastest speed is averaged over at least this much moving time, so a single GPS jump
 * (a walk "at" 14 km/h) doesn't count.
 */
export const TOP_SPEED_WINDOW_S = 5;

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

export { sustainedSpeed };

/**
 * Fastest kilometre, mile and sustained speed of each workout, loading tracks only for
 * those not cached.
 * @returns {Promise<Map<string, {km:number|null, mi:number|null, top:number|null}>>}
 */
export async function splitTimesFor(workouts, { onProgress, isCancelled } = {}) {
  const c = load();
  const out = new Map();
  const todo = [];
  for (const w of workouts) {
    const hit = c[w.id];
    if (hit && hit.v === versionKey(w)) out.set(w.id, { km: hit.km, mi: hit.mi, top: hit.top });
    else todo.push(w);
  }
  let done = 0;
  for (const w of todo) {
    if (isCancelled?.()) break;
    onProgress?.(done, todo.length);
    let km = null;
    let mi = null;
    let top = null;
    try {
      const track = await getTrack(w.id);
      if (track) {
        if (SPLIT_ACTIVITIES.has(w.activity)) {
          km = fastestSplit(track, 1000);
          mi = fastestSplit(track, M_PER_MI);
        }
        top = sustainedSpeed(track, TOP_SPEED_WINDOW_S);
      }
    } catch (e) {
      console.warn('Insights: no track for', w.id, e);
    }
    c[w.id] = { v: versionKey(w), km, mi, top };
    out.set(w.id, { km, mi, top });
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
 * in m/s, split in seconds for one km or mile (`units`), longest in metres. maxSpeed is the
 * sustained speed from the track; it is null until the track has been read.
 * @param {object[]} workouts
 * @param {Map<string, {km:number|null, mi:number|null, top:number|null}>} [splitTimes]  from splitTimesFor
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
    const t = splitTimes.get(w.id);
    consider('maxSpeed', t?.top, more);
    if (SPLIT_ACTIVITIES.has(w.activity)) {
      if ((s.distance ?? 0) >= MIN_AVG_DISTANCE_M) consider('avgSpeed', avgSpeedOf(s), more);
      consider('split', units === 'imperial' ? t?.mi : t?.km, (a, c) => a < c);
    }
  }
  return [...byActivity.values()];
}

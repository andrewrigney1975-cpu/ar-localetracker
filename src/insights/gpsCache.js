// Raw GPS distance per workout (stats/gpsDistance.js) for Insights → Export → GPS distance.
// Reading and unzipping a journal is slow (~30k lines), so results are cached in
// localStorage. A raw journal never changes after the workout is saved, so the cache is
// keyed by workout id and start time only.

import { getRawJournal } from '../db/workouts.js';
import { rawDistance } from '../stats/gpsDistance.js';

const KEY = 'insights.rawdist.v1';

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

/**
 * Raw distances for each workout, reading journals only for those not cached. Workouts
 * without a raw journal map to null.
 * @param {object[]} workouts
 * @param {{onProgress?: (done:number, total:number) => void}} [opts]
 * @returns {Promise<Map<string, ReturnType<typeof rawDistance>>>}
 */
export async function rawDistancesFor(workouts, { onProgress } = {}) {
  const c = load();
  const out = new Map();
  const todo = [];
  for (const w of workouts) {
    const hit = c[w.id];
    if (hit && hit.v === w.startedAt) out.set(w.id, hit.d);
    else todo.push(w);
  }
  let done = 0;
  for (const w of todo) {
    onProgress?.(done, todo.length);
    done++;
    let d;
    try {
      const text = await getRawJournal(w.id);
      d = text ? rawDistance(text) : null;
    } catch (e) {
      // A read error isn't cached, so the next export tries again.
      console.warn('GPS stats: could not read the raw journal of', w.id, e);
      out.set(w.id, null);
      continue;
    }
    out.set(w.id, d);
    c[w.id] = { v: w.startedAt, d };
  }
  if (todo.length) persist();
  return out;
}

/** Drop entries for deleted workouts. */
export function pruneRawDistanceCache(ids) {
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

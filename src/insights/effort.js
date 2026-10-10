// Calories and cardio load per workout for Insights. Both need the full track and the
// user's profile, so values are cached in localStorage by workout version and profile;
// a cold cache loads each track once.

import { getTrack } from '../db/workouts.js';
import { estimateCalories, maxHeartRate, profileComplete, trimp } from '../stats/physio.js';

const KEY = 'insights.effort.v1';

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

const profileKey = (p) => [p?.sex, p?.birthYear, p?.weightKg, p?.restingHr, p?.maxHr].join('/');
const versionKey = (w, profile) => `${w.activity}|${w.updatedAt ?? w.createdAt ?? 0}|${profileKey(profile)}`;

/** What the profile allows: calories need sex, age and weight; cardio load needs a max heart rate. */
export function effortAvailability(profile) {
  return { calories: profileComplete(profile), cardioLoad: Boolean(maxHeartRate(profile)) };
}

/**
 * Effort values for each workout, loading tracks only for those not cached.
 * @param {object[]} workouts
 * @param {object} profile
 * @param {{onProgress?: (done:number, total:number) => void, isCancelled?: () => boolean}} [opts]
 * @returns {Promise<Map<string, {kcal:number|null, load:number|null}>>}
 */
export async function effortFor(workouts, profile, { onProgress, isCancelled } = {}) {
  const c = load();
  const can = effortAvailability(profile);
  const out = new Map();
  const todo = [];
  for (const w of workouts) {
    const needs = can.calories || (can.cardioLoad && w.summary?.heartRate);
    if (!needs) {
      out.set(w.id, { kcal: null, load: null });
      continue;
    }
    const hit = c[w.id];
    if (hit && hit.v === versionKey(w, profile)) out.set(w.id, { kcal: hit.kcal, load: hit.load });
    else todo.push(w);
  }
  let done = 0;
  for (const w of todo) {
    if (isCancelled?.()) break;
    onProgress?.(done, todo.length);
    let kcal = null;
    let trainingLoad = null;
    try {
      const track = await getTrack(w.id);
      if (track) {
        kcal = estimateCalories(track, w.activity, profile, w.startedAt)?.kcal ?? null;
        trainingLoad = track.hr ? trimp(track, profile, w.startedAt) : null;
      }
    } catch (e) {
      console.warn('Insights: no track for', w.id, e);
    }
    c[w.id] = { v: versionKey(w, profile), kcal, load: trainingLoad };
    out.set(w.id, { kcal, load: trainingLoad });
    done++;
    if (done % 20 === 0) persist();
  }
  if (todo.length) persist();
  onProgress?.(todo.length, todo.length);
  return out;
}

/** Drop cache entries for workouts that no longer exist. */
export function pruneEffortCache(ids) {
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

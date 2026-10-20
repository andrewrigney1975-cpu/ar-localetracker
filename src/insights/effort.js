// Calories, cardio load and the VO2max estimate per workout (Insights, Settings). All need
// the full track and the user's profile, so values are cached in localStorage by workout
// version and profile; a cold cache loads each track once.

import { getTrack } from '../db/workouts.js';
import { estimateCalories, maxHeartRate, profileComplete, trimp } from '../stats/physio.js';
import { VO2_ACTIVITIES, vo2Available, workoutVo2max } from '../stats/vo2max.js';

const KEY = 'insights.effort.v2';

let cache = null;

function load() {
  if (cache) return cache;
  try {
    localStorage.removeItem('insights.effort.v1'); // before VO2max was cached
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

/** What the profile allows: calories and VO2max need sex, age and weight; cardio load needs a max heart rate. */
export function effortAvailability(profile) {
  return { calories: profileComplete(profile), cardioLoad: Boolean(maxHeartRate(profile)), vo2max: vo2Available(profile) };
}

/**
 * Effort values for each workout, loading tracks only for those not cached.
 * @param {object[]} workouts
 * @param {object} profile
 * @param {{onProgress?: (done:number, total:number) => void, isCancelled?: () => boolean}} [opts]
 * @returns {Promise<Map<string, {kcal:number|null, load:number|null, vo2:number|null}>>}
 */
export async function effortFor(workouts, profile, { onProgress, isCancelled } = {}) {
  const c = load();
  const can = effortAvailability(profile);
  const out = new Map();
  const todo = [];
  for (const w of workouts) {
    const needs = can.calories || ((can.cardioLoad || can.vo2max) && w.summary?.heartRate);
    if (!needs) {
      out.set(w.id, { kcal: null, load: null, vo2: null });
      continue;
    }
    const hit = c[w.id];
    if (hit && hit.v === versionKey(w, profile)) out.set(w.id, { kcal: hit.kcal, load: hit.load, vo2: hit.vo2 ?? null });
    else todo.push(w);
  }
  let done = 0;
  for (const w of todo) {
    if (isCancelled?.()) break;
    onProgress?.(done, todo.length);
    let kcal = null;
    let trainingLoad = null;
    let vo2 = null;
    try {
      const track = await getTrack(w.id);
      if (track) {
        kcal = estimateCalories(track, w.activity, profile, w.startedAt)?.kcal ?? null;
        trainingLoad = track.hr ? trimp(track, profile, w.startedAt) : null;
        if (track.hr && VO2_ACTIVITIES.includes(w.activity)) vo2 = workoutVo2max(track, w.activity, profile, w.startedAt).value;
      }
    } catch (e) {
      console.warn('Insights: no track for', w.id, e);
    }
    c[w.id] = { v: versionKey(w, profile), kcal, load: trainingLoad, vo2 };
    out.set(w.id, { kcal, load: trainingLoad, vo2 });
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

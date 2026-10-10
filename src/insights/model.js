// The learned routine model: rebuilt from the workout list whenever it changes and stored
// with @capacitor/preferences ("routines.v1"), where TrackingService (RoutineMatcher.java)
// reads it for watch- and widget-started workouts.

import { Preferences } from '@capacitor/preferences';
import { listWorkouts } from '../db/workouts.js';
import { settings } from '../settings.js';
import { MODEL_VERSION, buildRoutineModel } from './routines.js';

const KEY = 'routines.v1';
let cached = null;
let timer = 0;

export async function rebuildRoutineModel() {
  const { excluded, names } = settings().routines;
  cached = buildRoutineModel(await listWorkouts(), { excluded, names });
  await Preferences.set({ key: KEY, value: JSON.stringify(cached) });
  window.dispatchEvent(new CustomEvent('routines-changed'));
  return cached;
}

/** Debounced rebuild, e.g. after a save, delete or sync. */
export function scheduleRoutineRebuild(delayMs = 400) {
  clearTimeout(timer);
  timer = setTimeout(() => rebuildRoutineModel().catch((e) => console.error('Routine model rebuild failed', e)), delayMs);
}

export async function getRoutineModel() {
  if (cached) return cached;
  try {
    const { value } = await Preferences.get({ key: KEY });
    const m = value ? JSON.parse(value) : null;
    if (m?.v === MODEL_VERSION) cached = m;
  } catch {
    /* rebuild below */
  }
  return cached ?? rebuildRoutineModel();
}

/** Synchronous read of the last loaded model (null until loaded). */
export function cachedRoutineModel() {
  return cached;
}

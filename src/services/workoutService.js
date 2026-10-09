// Turns finished native journals into stored workouts.

import { currentBackend, hasWorkout, saveWorkout } from '../db/workouts.js';
import { buildWorkout } from './buildWorkout.js';
import { tracker } from '../tracker/client.js';

export { buildWorkout, defaultName, newWorkoutId } from './buildWorkout.js';

/**
 * After a stop on Android, TrackingService processes and stores the workout itself (SQLite).
 * Wait briefly for that before falling back to importing the journal in JS.
 */
export async function waitForNativeSave(workoutId, timeoutMs = 4000) {
  if (!workoutId || currentBackend() !== 'sqlite') return false;
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await hasWorkout(workoutId)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * Read, process and save a finished journal, then delete it.
 * @returns {Promise<object|null>} the workout, or null if it had too few points to keep
 */
export async function finalizeJournal(workoutId, { keepEmpty = false } = {}) {
  const text = await tracker.readJournal(workoutId);
  const { workout, track } = buildWorkout(text, workoutId);
  if (track.n < 2 && !keepEmpty) return null;
  await saveWorkout(workout, track, text);
  await tracker.deleteJournal(workoutId);
  return workout;
}

/**
 * Import journals that finished while the UI wasn't watching (e.g. stopped from the
 * notification) and report interrupted ones the user must decide about.
 */
export async function recoverJournals() {
  const journals = await tracker.listJournals();
  const imported = [];
  const interrupted = [];
  for (const j of journals) {
    if (j.active) continue;
    if (await hasWorkout(j.workoutId)) {
      await tracker.deleteJournal(j.workoutId);
      continue;
    }
    if (j.ended) {
      const w = await finalizeJournal(j.workoutId);
      if (w) imported.push(w);
      else await tracker.deleteJournal(j.workoutId);
    } else {
      interrupted.push(j);
    }
  }
  return { imported, interrupted };
}

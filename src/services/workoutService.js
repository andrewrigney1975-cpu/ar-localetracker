// Turns finished native journals into stored workouts.

import { activity as activityProfile } from '../activities.js';
import { hasWorkout, saveWorkout } from '../db/workouts.js';
import { processJournal } from '../geo/process.js';
import { computeSummary, previewPolyline } from '../stats/summary.js';
import { parseJournal } from '../tracker/journal.js';
import { tracker } from '../tracker/client.js';

export function newWorkoutId() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6);
  return `w${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}-${rand}`;
}

export function defaultName(activityId, startedAt) {
  const h = new Date(startedAt).getHours();
  const part = h < 5 ? 'Night' : h < 12 ? 'Morning' : h < 17 ? 'Afternoon' : h < 21 ? 'Evening' : 'Night';
  return `${part} ${activityProfile(activityId).label}`;
}

/** Build a workout record + processed track from journal text. */
export function buildWorkout(text, idOverride) {
  const journal = parseJournal(text);
  const { track, info } = processJournal(journal);
  const id = idOverride ?? journal.meta?.workoutId ?? newWorkoutId();
  const summary = computeSummary(track, info);
  const workout = {
    id,
    activity: info.activity,
    name: defaultName(info.activity, info.startedAt),
    notes: '',
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    createdAt: Date.now(),
    tzOffset: new Date(info.startedAt).getTimezoneOffset(),
    device: info.device,
    activeIntervals: info.activeIntervals,
    summary,
    preview: previewPolyline(track),
  };
  return { workout, track, journal };
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

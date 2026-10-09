// Workout persistence: summary records, columnar tracks and gzipped raw journals.

import { tx } from './idb.js';

export async function saveWorkout(workout, track, rawText) {
  const raw = rawText != null ? await gzip(rawText) : null;
  await tx(['workouts', 'tracks', 'raw'], 'readwrite', ({ workouts, tracks, raw: rawStore }) => {
    workouts.put(workout);
    tracks.put({ workoutId: workout.id, ...track });
    if (raw) rawStore.put({ workoutId: workout.id, gzip: raw });
  });
  return workout;
}

export async function listWorkouts() {
  const all = await tx('workouts', 'readonly', ({ workouts }, p) => p(workouts.getAll()));
  return all.sort((a, b) => b.startedAt - a.startedAt);
}

export function getWorkout(id) {
  return tx('workouts', 'readonly', ({ workouts }, p) => p(workouts.get(id)));
}

export async function getTrack(id) {
  const rec = await tx('tracks', 'readonly', ({ tracks }, p) => p(tracks.get(id)));
  if (!rec) return null;
  delete rec.workoutId;
  return rec;
}

export async function getRawJournal(id) {
  const rec = await tx('raw', 'readonly', ({ raw }, p) => p(raw.get(id)));
  return rec ? gunzip(rec.gzip) : null;
}

export async function updateWorkout(id, patch) {
  return tx('workouts', 'readwrite', async ({ workouts }, p) => {
    const w = await p(workouts.get(id));
    if (!w) throw new Error('Workout not found');
    const next = { ...w, ...patch, updatedAt: Date.now() };
    workouts.put(next);
    return next;
  });
}

export function deleteWorkout(id) {
  return tx(['workouts', 'tracks', 'raw'], 'readwrite', ({ workouts, tracks, raw }) => {
    workouts.delete(id);
    tracks.delete(id);
    raw.delete(id);
  });
}

export async function hasWorkout(id) {
  return Boolean(await tx('workouts', 'readonly', ({ workouts }, p) => p(workouts.getKey(id))));
}

async function gzip(text) {
  if (typeof CompressionStream === 'undefined') return new Blob([text], { type: 'text/plain' });
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(stream).blob().then((b) => new Blob([b], { type: 'application/gzip' }));
}

async function gunzip(blob) {
  if (blob.type !== 'application/gzip') return blob.text();
  const stream = blob.stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

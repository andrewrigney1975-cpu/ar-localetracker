// SQLite workout store on Android (LocaleStore plugin → WorkoutStore.java).
// Same API as idbStore.js.

import { registerPlugin } from '@capacitor/core';
import { gunzip, gzip } from './idbStore.js';
import { crc32, fromBase64, packTrack, toBase64, unpackTrack } from './trackCodec.js';

export const LocaleStore = registerPlugin('LocaleStore');

/** Build a plugin save item: {workout, track: {blob, crc32}, raw?: {gzip, crc32}}. */
export function saveItem(workout, track, rawGzipBytes) {
  const blob = packTrack(track);
  const item = { workout, track: { blob: toBase64(blob), crc32: crc32(blob) } };
  const expected = { id: workout.id, n: track.n, trackCrc: crc32(blob), rawCrc: -1 };
  if (rawGzipBytes) {
    item.raw = { gzip: toBase64(rawGzipBytes), crc32: crc32(rawGzipBytes) };
    expected.rawCrc = crc32(rawGzipBytes);
  }
  return { item, expected };
}

export async function saveWorkout(workout, track, rawText) {
  const raw = rawText != null ? new Uint8Array(await (await gzip(rawText)).arrayBuffer()) : null;
  const { item, expected } = saveItem(workout, track, raw);
  const stored = await LocaleStore.saveWorkout(item);
  if (stored.n !== expected.n || stored.trackCrc !== expected.trackCrc) throw new Error('Workout did not save intact');
  return workout;
}

export async function listWorkouts() {
  return (await LocaleStore.listWorkouts()).workouts;
}

export async function getWorkout(id) {
  return (await LocaleStore.getWorkout({ id })).workout ?? undefined;
}

export async function getTrack(id) {
  const { blob } = await LocaleStore.getTrack({ id });
  return blob ? unpackTrack(fromBase64(blob)) : null;
}

export async function getRawJournal(id) {
  const { gzip: b64 } = await LocaleStore.getRawJournal({ id });
  return b64 ? gunzip(new Blob([fromBase64(b64)], { type: 'application/gzip' })) : null;
}

export async function updateWorkout(id, patch) {
  return (await LocaleStore.updateWorkout({ id, patch })).workout;
}

export async function deleteWorkout(id) {
  await LocaleStore.deleteWorkout({ id });
}

export async function hasWorkout(id) {
  return (await LocaleStore.hasWorkout({ id })).exists;
}

// Used by the migration runner.
export const bulkImport = async (items) => (await LocaleStore.bulkImport({ items })).results;
export const stats = () => LocaleStore.stats();
export const getMeta = async (key) => (await LocaleStore.getMeta({ key })).value;
export const setMeta = (key, value) => LocaleStore.setMeta({ key, value });

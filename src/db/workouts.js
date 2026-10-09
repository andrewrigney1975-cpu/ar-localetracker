// Workout persistence facade. Views import from here; the backend is IndexedDB in the
// browser and SQLite on Android once the one-time migration has succeeded (see migrate.js).

import * as idbStore from './idbStore.js';

let backend = idbStore;
let backendName = 'indexeddb';

export function useBackend(store, name) {
  backend = store;
  backendName = name;
}

export function currentBackend() {
  return backendName;
}

export const saveWorkout = (...args) => backend.saveWorkout(...args);
export const listWorkouts = (...args) => backend.listWorkouts(...args);
export const getWorkout = (...args) => backend.getWorkout(...args);
export const getTrack = (...args) => backend.getTrack(...args);
export const getRawJournal = (...args) => backend.getRawJournal(...args);
export const updateWorkout = (...args) => backend.updateWorkout(...args);
export const deleteWorkout = (...args) => backend.deleteWorkout(...args);
export const hasWorkout = (...args) => backend.hasWorkout(...args);

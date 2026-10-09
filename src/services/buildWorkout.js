// Pure journal → workout record + processed track (no I/O). Ported to Java in
// WorkoutBuilder.java for native finalisation; keep the two in sync.

import { activity as activityProfile } from '../activities.js';
import { processJournal } from '../geo/process.js';
import { computeSummary, previewPolyline } from '../stats/summary.js';
import { parseJournal } from '../tracker/journal.js';

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

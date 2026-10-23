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

/** The goal used for this workout, as stored on the record (goal-prediction feedback). */
export function predictionRecord(g) {
  if (!g || !(g.goalM > 0)) return null;
  const p = { goalM: g.goalM, source: g.source ?? 'manual', routineId: g.routineId ?? null };
  if (g.name) p.name = g.name;
  if (Number.isFinite(g.confidence)) p.confidence = g.confidence;
  if (g.offRoute) p.offRoute = true;
  return p;
}

/**
 * Build a workout record + processed track from journal text. `activityOverride` re-processes
 * a journal as another activity (the user changed the type after recording).
 */
export function buildWorkout(text, idOverride, activityOverride) {
  const journal = parseJournal(text);
  const { track, info } = processJournal(journal, activityOverride);
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
  const prediction = predictionRecord(journal.goal);
  if (prediction) workout.prediction = prediction;
  // The workout's high-intensity interval plans, as run (the HII status in the log).
  if (journal.hii.length) workout.hii = journal.hii;
  return { workout, track, journal };
}

/**
 * The record and track for `w` as another activity. With the raw journal the workout is
 * re-processed with the new activity's filters (accuracy gate, speed limits, moving
 * threshold); without one (imports, the sample) only the summary is recomputed, which
 * adds or drops the ski runs and lifts. Name, notes and goal stay; a default name follows
 * the new activity.
 */
export function rebuildAsActivity(w, activityId, { rawText = null, track = null } = {}) {
  let next;
  let nextTrack;
  if (rawText != null) {
    const built = buildWorkout(rawText, w.id, activityId);
    nextTrack = built.track;
    next = { ...w, activity: activityId, summary: built.workout.summary, preview: built.workout.preview, activeIntervals: built.workout.activeIntervals };
  } else {
    nextTrack = track;
    const info = {
      activity: activityId,
      startedAt: w.startedAt,
      endedAt: w.endedAt,
      activeSeconds: w.summary.duration,
      hasBarometer: w.summary.hasBarometer,
    };
    next = { ...w, activity: activityId, summary: computeSummary(track, info) };
  }
  if (w.name === defaultName(w.activity, w.startedAt)) next.name = defaultName(activityId, w.startedAt);
  next.updatedAt = Date.now();
  return { workout: next, track: nextTrack };
}

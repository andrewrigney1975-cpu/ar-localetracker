// Plain-text workout summary for SMS / chat sharing.

import { activity as activityProfile } from '../activities.js';
import {
  formatAltitude,
  formatDate,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
} from '../units.js';

/**
 * Build a short message such as:
 *
 *   City2Surf 2026 — Run, Sun 9 Aug 2026
 *   14.37 km in 1:30:29 · 6:18 /km avg
 *   Climb +242 m · Avg HR 149 bpm · 1,373 kcal
 *   Recorded with Locale
 *
 * Lines and fields without data are left out.
 *
 * @param {object} workout  stored workout (name, activity, startedAt, summary)
 * @param {{units?: 'metric'|'imperial', calories?: number|null, formatDay?: (ms:number)=>string}} [opts]
 */
export function workoutShareText(workout, { units = 'metric', calories = null, formatDay = formatDate } = {}) {
  const act = activityProfile(workout.activity);
  const sm = workout.summary ?? {};
  const lines = [];

  const title = workout.name?.trim() || act.label;
  const sameAsLabel = title.toLowerCase().includes(act.label.toLowerCase());
  lines.push(`${title} — ${sameAsLabel ? '' : `${act.label}, `}${formatDay(workout.startedAt)}`);

  // Distance, time and the activity's natural speed measure (pace for walk/run).
  const main = [`${formatDistance(sm.distance ?? 0, units)} in ${formatDuration(sm.duration ?? 0)}`];
  const avg = sm.avgMovingSpeed || sm.avgSpeed;
  if (avg > 0) main.push(act.liveSpeedMode === 'pace' ? `${formatPace(avg, units)} avg` : `${formatSpeed(avg, units)} avg`);
  lines.push(main.join(' · '));

  const extra = [];
  if (act.id === 'ski' && sm.ski) {
    if (sm.ski.runs) extra.push(`${sm.ski.runs} run${sm.ski.runs === 1 ? '' : 's'}`);
    if (sm.ski.descentVertical > 0) extra.push(`${formatAltitude(sm.ski.descentVertical, units)} vertical`);
    if (sm.maxSpeed > 0) extra.push(`max ${formatSpeed(sm.maxSpeed, units)}`);
  } else if (sm.elevGain >= 1) {
    extra.push(`Climb +${formatAltitude(sm.elevGain, units)}`);
  }
  if (sm.heartRate?.avg) extra.push(`Avg HR ${Math.round(sm.heartRate.avg)} bpm`);
  if (Number.isFinite(calories) && calories > 0) extra.push(`${Math.round(calories).toLocaleString()} kcal`);
  if (extra.length) lines.push(extra.join(' · '));

  lines.push('Recorded with Locale');
  return lines.join('\n');
}

/**
 * Plain-text current location for sharing, e.g.
 *
 *   My location: -33.873120, 151.211130
 *   ±5 m · altitude 32 m
 *   https://maps.google.com/?q=-33.873120,151.211130
 */
export function locationShareText({ lat, lon, accuracy, altitude }, { units = 'metric' } = {}) {
  const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const details = [];
  if (Number.isFinite(accuracy)) details.push(`±${Math.round(accuracy)} m`);
  if (Number.isFinite(altitude)) details.push(`altitude ${formatAltitude(altitude, units)}`);
  const lines = [`My location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`];
  if (details.length) lines.push(details.join(' · '));
  lines.push(`https://maps.google.com/?q=${ll}`);
  return lines.join('\n');
}

/** `sms:` URI that opens the default messaging app with the text pre-filled. */
export function smsUri(text) {
  return `sms:?body=${encodeURIComponent(text)}`;
}

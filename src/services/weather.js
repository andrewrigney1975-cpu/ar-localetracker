// Look up and store the weather at each workout's start (weather/weather.js), for new
// workouts and as a back-fill for older ones. Runs in the WebView after a workout is saved,
// so workouts stopped from the watch or a widget get it when the app next opens. Offline
// lookups are retried later; times Open-Meteo has no data for are marked so they aren't.

import { listWorkouts, updateWorkout } from '../db/workouts.js';
import { settings } from '../settings.js';
import { parseWeather, roundCoord, weatherUrls } from '../weather/weather.js';

/** After a failed lookup (offline, server error), wait this long before trying that workout again. */
const RETRY_MS = 10 * 60000;
/** Pause between requests, to be gentle with a free service during a back-fill. */
const GAP_MS = 250;

const failedAt = new Map();
let inFlight = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The start of the route, [lat, lon], from the stored preview polyline ([lon, lat] points). */
function startOf(w) {
  const p = w.preview?.[0];
  return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[1], p[0]] : null;
}

export const needsWeather = (w) => !w.weather && Boolean(startOf(w)) && Number.isFinite(w.startedAt);

/**
 * Fetch the weather for one workout and store it on the record.
 * @returns {Promise<object|null>} the updated workout, or null if the lookup failed (try again later)
 */
export async function lookupWeather(w, { fetchImpl = fetch } = {}) {
  const start = startOf(w);
  if (!start) return null;
  const [lat, lon] = start;
  let reached = false;
  for (const { source, url } of weatherUrls(lat, lon, w.startedAt)) {
    let json;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        // 400: that API has no data for the date; the next one may.
        if (res.status === 400) reached = true;
        continue;
      }
      json = await res.json();
      reached = true;
    } catch {
      continue;
    }
    const weather = parseWeather(json, w.startedAt);
    if (weather) return updateWorkout(w.id, { weather: { ...weather, source, lat: roundCoord(lat), lon: roundCoord(lon), fetchedAt: Date.now() } });
  }
  // Every service answered without data for that time: don't ask again.
  if (reached) return updateWorkout(w.id, { weather: { unavailable: true, fetchedAt: Date.now() } });
  failedAt.set(w.id, Date.now());
  return null;
}

/**
 * Fill in the weather for every workout that hasn't got it, newest first, one at a time.
 * Concurrent calls share one run. Lists refresh once at the end if anything changed.
 * @returns {Promise<number>} workouts updated
 */
export function fillWeather() {
  if (!settings().weather) return Promise.resolve(0);
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run() {
  const now = Date.now();
  const todo = (await listWorkouts())
    .filter((w) => needsWeather(w) && !(now - (failedAt.get(w.id) ?? 0) < RETRY_MS))
    .sort((a, b) => b.startedAt - a.startedAt);
  let done = 0;
  for (const w of todo) {
    if (!settings().weather) break;
    try {
      if (await lookupWeather(w)) done++;
    } catch (e) {
      console.warn('Weather lookup failed', w.id, e);
      failedAt.set(w.id, Date.now());
    }
    await sleep(GAP_MS);
  }
  if (done) window.dispatchEvent(new CustomEvent('workouts-changed', { detail: { weather: true } }));
  return done;
}

// Synthetic workout histories with known routines, for the goal-prediction tests and
// scripts/evaluate-goals.mjs. Records have the fields buildRoutineModel() reads.

import { destination } from '../../src/geo/geo.js';

const DAY = 86400000;
export const HOME = { lat: -33.8915, lon: 151.2767 }; // Bondi
export const PARK = { lat: -33.8960, lon: 151.2415 }; // Centennial Park

export function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

/** Normal-ish noise (sum of uniforms). */
const gauss = (rand) => (rand() + rand() + rand() + rand() - 2) / 0.577;

/** Closed loop of the given length starting and ending at `from`. */
export function loopRoute(from, lengthM, bearingDeg, rand, jitterM = 4) {
  const r = lengthM / (2 * Math.PI);
  const centre = destination(from.lat, from.lon, bearingDeg, r);
  const pts = [];
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const a = bearingDeg + 180 + (360 * i) / n;
    const [lat, lon] = destination(centre[0], centre[1], a, r + gauss(rand) * jitterM);
    pts.push([lon, lat]);
  }
  return pts;
}

/** Out along a bearing for half the length, then back. */
export function outAndBack(from, lengthM, bearingDeg, rand, jitterM = 4) {
  const pts = [];
  const n = 45;
  for (let i = 0; i <= n; i++) {
    const [lat, lon] = destination(from.lat, from.lon, bearingDeg + gauss(rand) * 0.3, ((lengthM / 2) * i) / n + gauss(rand) * jitterM);
    pts.push([lon, lat]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const [lat, lon] = destination(from.lat, from.lon, bearingDeg + 0.2 + gauss(rand) * 0.3, ((lengthM / 2) * i) / n + gauss(rand) * jitterM);
    pts.push([lon, lat]);
  }
  return pts;
}

/**
 * Build workout records.
 * routines: [{activity, weekdays:[0-6], hour, minute, jitterMin, shape:'loop'|'outback', from, bearing,
 *             distanceM, sdPct, speed, p}]
 * oneOffsPerWeek: random workouts from random places/times.
 */
export function makeHistory({ seed = 1, startDay = Date.UTC(2026, 0, 5), weeks = 20, tzOffset = -600, routines = [], oneOffsPerWeek = 1, oneOffFrom = null } = {}) {
  const rand = rng(seed);
  const out = [];
  let k = 0;
  const add = (activity, localMs, from, shape, distanceM, bearing, speed) => {
    const preview = shape === 'loop' ? loopRoute(from, distanceM, bearing, rand) : outAndBack(from, distanceM, bearing, rand);
    const startedAt = localMs + tzOffset * 60000;
    const duration = Math.round(distanceM / speed);
    out.push({
      id: `w${String(++k).padStart(4, '0')}`,
      activity,
      name: 'Synthetic',
      startedAt,
      endedAt: startedAt + duration * 1000,
      tzOffset,
      summary: { distance: Math.round(distanceM * 10) / 10, duration },
      preview,
    });
  };
  for (let day = 0; day < weeks * 7; day++) {
    const dayMs = startDay + day * DAY;
    const weekday = new Date(dayMs).getUTCDay();
    for (const r of routines) {
      if (!r.weekdays.includes(weekday) || rand() > (r.p ?? 0.9)) continue;
      const minute = r.hour * 60 + r.minute + Math.round(gauss(rand) * (r.jitterMin ?? 15));
      const dist = r.distanceM * (1 + gauss(rand) * (r.sdPct ?? 0.02));
      add(r.activity, dayMs + minute * 60000, r.from, r.shape, dist, r.bearing + gauss(rand) * 2, r.speed ?? 2.7);
    }
    if (rand() < oneOffsPerWeek / 7) {
      const activity = ['walk', 'run', 'run', 'cycle'][Math.floor(rand() * 4)];
      const from = oneOffFrom ?? { lat: HOME.lat + (rand() - 0.5) * 0.2, lon: HOME.lon + (rand() - 0.5) * 0.2 };
      const minute = 360 + Math.floor(rand() * 900);
      const dist = activity === 'cycle' ? 10000 + rand() * 50000 : 1500 + rand() * 14000;
      add(activity, dayMs + minute * 60000, from, rand() < 0.5 ? 'loop' : 'outback', dist, rand() * 360, activity === 'cycle' ? 7 : 2.5);
    }
  }
  return out.sort((a, b) => a.startedAt - b.startedAt);
}

/** A typical person: three routines plus one-offs. */
export const TYPICAL = {
  routines: [
    { activity: 'walk', weekdays: [6], hour: 7, minute: 0, shape: 'loop', from: HOME, bearing: 200, distanceM: 4700, sdPct: 0.015, speed: 1.4 },
    { activity: 'run', weekdays: [2, 4], hour: 18, minute: 15, shape: 'outback', from: HOME, bearing: 300, distanceM: 8000, sdPct: 0.02, speed: 2.8 },
    { activity: 'run', weekdays: [0], hour: 8, minute: 30, shape: 'loop', from: PARK, bearing: 90, distanceM: 10050, sdPct: 0.01, speed: 2.9 },
    { activity: 'cycle', weekdays: [0], hour: 6, minute: 30, shape: 'outback', from: HOME, bearing: 20, distanceM: 40000, sdPct: 0.03, speed: 7.5, p: 0.6 },
  ],
};

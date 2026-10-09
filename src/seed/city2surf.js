// Generates a realistic 1 Hz GPS journal for a run along the Sydney City2Surf course.
// Used to seed a sample historical workout; deterministic for a given seed.

import { bearing, destination, haversine } from '../geo/geo.js';
import { processJournal } from '../geo/process.js';
import { computeSummary } from '../stats/summary.js';
import { parseJournal } from '../tracker/journal.js';
import { HeartModel, mulberry32 } from '../tracker/synthetic.js';
import course from './city2surf-course.json';

export const CITY2SURF_SAMPLE_ID = 'sample-city2surf-2026';
/** Sunday 9 August 2026, 08:52 AEST (UTC+10). */
export const CITY2SURF_START = Date.UTC(2026, 7, 8, 22, 52, 0);
export const TARGET_PACE = 378; // 6:18 per km, in seconds
export const PACE_SPREAD = 27; // keep each km within ±27 s so processed splits stay inside ±30 s

function gaussian(rand) {
  const u = Math.max(1e-9, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

/** Cumulative distances along the course polyline. */
function measure(points) {
  const cum = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    cum[i] = cum[i - 1] + haversine(a[0], a[1], b[0], b[1]);
  }
  return cum;
}

function sampleCourse(points, cum, s) {
  let lo = 0;
  let hi = points.length - 1;
  if (s >= cum[hi]) return { lat: points[hi][0], lon: points[hi][1], ele: points[hi][2], i: hi - 1 };
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const f = (s - cum[lo]) / (cum[hi] - cum[lo] || 1);
  const [a, b] = [points[lo], points[hi]];
  return { lat: a[0] + (b[0] - a[0]) * f, lon: a[1] + (b[1] - a[1]) * f, ele: a[2] + (b[2] - a[2]) * f, i: lo };
}

/**
 * Per-km target paces (s/km): slower uphill (Heartbreak Hill), a little faster downhill,
 * a congested first km, plus run-to-run variation, renormalised to the target average.
 */
export function planPaces(points, cum, rand, target = TARGET_PACE, spread = PACE_SPREAD) {
  const total = cum[cum.length - 1];
  const kms = Math.ceil(total / 1000);
  const lens = [];
  const raw = [];
  for (let k = 0; k < kms; k++) {
    const s0 = k * 1000;
    const s1 = Math.min(total, s0 + 1000);
    lens.push(s1 - s0);
    const grade = ((sampleCourse(points, cum, s1).ele - sampleCourse(points, cum, s0).ele) / (s1 - s0)) * 100;
    let off = grade > 0 ? grade * 6 : grade * 3; // seconds per 1% grade
    if (k === 0) off += 14; // crowded start
    off += gaussian(rand) * 7;
    raw.push(off);
  }
  // Shift so the distance-weighted average equals the target, then clamp; repeat to converge.
  let offs = raw.slice();
  for (let iter = 0; iter < 50; iter++) {
    const mean = offs.reduce((a, o, k) => a + o * lens[k], 0) / total;
    offs = offs.map((o) => Math.max(-spread, Math.min(spread, o - mean)));
    if (Math.abs(mean) < 1e-6) break;
  }
  return offs.map((o) => target + o);
}

/**
 * @returns {{text: string, paces: number[], courseLength: number}}
 */
export function generateCity2SurfJournal({ seed = 2026, startedAt = CITY2SURF_START, workoutId = CITY2SURF_SAMPLE_ID, target = TARGET_PACE } = {}) {
  const rand = mulberry32(seed);
  const pts = course.points;
  const cum = measure(pts);
  const total = cum[cum.length - 1];
  const paces = planPaces(pts, cum, rand, target);

  const lines = [];
  lines.push({
    type: 'meta',
    v: 1,
    workoutId,
    activity: 'run',
    startedAt,
    autoPause: false,
    hasBarometer: true,
    device: 'Sample data',
  });
  lines.push({ type: 'state', t: startedAt, state: 'recording', reason: 'start', seg: 0 });

  // Correlated GNSS error (AR(1)) gives realistic wander rather than white jitter.
  let nE = 0;
  let nN = 0;
  let nAlt = 0;
  const rho = 0.92;
  const kick = Math.sqrt(1 - rho * rho);
  const basePressure = 1018.6; // a fine August morning
  let s = 0;
  let t = startedAt;
  let seq = 0;
  let phase = rand() * 10;
  const heart = new HeartModel({ rest: 56, max: 184, seed: seed + 7 });
  while (s < total) {
    t += 1000;
    const k = Math.min(paces.length - 1, Math.floor(s / 1000));
    // Gentle surges and fades around the km target (cadence/crowd), averaging out over a km.
    phase += 0.045 + rand() * 0.01;
    const v = (1000 / paces[k]) * (1 + 0.035 * Math.sin(phase) + gaussian(rand) * 0.01);
    s = Math.min(total, s + v);
    const p = sampleCourse(pts, cum, s);
    const ahead = sampleCourse(pts, cum, Math.min(total, s + 15));
    const behind = sampleCourse(pts, cum, Math.max(0, s - 25));
    const gradePct = ((sampleCourse(pts, cum, Math.min(total, s + 25)).ele - behind.ele) / 50) * 100;
    const bpm = heart.step(1, 'run', v, gradePct);
    const heading = bearing(p.lat, p.lon, ahead.lat, ahead.lon);

    const ha = 3 + Math.abs(gaussian(rand)) * 1.2;
    nE = rho * nE + kick * gaussian(rand) * ha * 0.6;
    nN = rho * nN + kick * gaussian(rand) * ha * 0.6;
    nAlt = 0.98 * nAlt + Math.sqrt(1 - 0.98 * 0.98) * gaussian(rand) * 0.35;
    const [lat1] = destination(p.lat, p.lon, 0, nN);
    const [, lon1] = destination(lat1, p.lon, 90, nE);
    const alt = p.ele + nAlt;
    const msl = p.ele + gaussian(rand) * 3.5;

    lines.push({
      type: 'pt',
      s: ++seq,
      t,
      lat: round(lat1, 7),
      lon: round(lon1, 7),
      ha: round(ha, 1),
      ae: round(msl + 22.4, 2), // WGS84 ellipsoid is ~22 m above the geoid in Sydney
      am: round(msl, 2),
      va: round(ha * 1.5, 1),
      sp: round(Math.max(0, v + gaussian(rand) * 0.08), 2),
      sa: 0.3,
      br: round((heading + gaussian(rand) * 2 + 360) % 360, 1),
      ba: 6,
      pr: round(basePressure * Math.pow(1 - alt / 44330, 5.255), 3),
      af: round(alt, 2),
      sv: 24 + Math.floor(rand() * 9),
      seg: 0,
    });
    lines.push({ type: 'hr', t, bpm });
  }
  lines.push({ type: 'state', t, state: 'idle', reason: 'stop', seg: 0 });
  lines.push({ type: 'end', t });
  return { text: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', paces, courseLength: total };
}

/**
 * Generate, measure with the app's own processing, and regenerate once with the pace
 * rescaled, so the app reports exactly the target average (GPS wander adds a little distance).
 */
export function generateCalibratedCity2Surf(opts = {}) {
  const measure1 = (text) => {
    const { track, info } = processJournal(parseJournal(text));
    const s = computeSummary(track, info);
    return s.duration / (s.distance / 1000);
  };
  // Changing the pace changes the number of fixes and so the noise realisation; iterate.
  let target = TARGET_PACE;
  let best = null;
  for (let i = 0; i < 6; i++) {
    const out = generateCity2SurfJournal({ ...opts, target });
    const err = measure1(out.text) - TARGET_PACE;
    if (!best || Math.abs(err) < Math.abs(best.err)) best = { out, err };
    if (Math.abs(err) < 0.3) break;
    target -= err;
  }
  return best.out;
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

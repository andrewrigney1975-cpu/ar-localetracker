// Post-processing pipeline: raw journal → cleaned, smoothed, columnar track.

import { activity as activityProfile } from '../activities.js';
import { activeIntervals } from '../tracker/journal.js';
import { haversine, makeProjection, bearing as bearingBetween } from './geo.js';
import { smoothAxis } from './kalman.js';

/**
 * @typedef {object} Track
 * @property {number} n
 * @property {Float64Array} t      epoch ms
 * @property {Float64Array} lat
 * @property {Float64Array} lon
 * @property {Float32Array} alt    metres (NaN when unknown)
 * @property {Float32Array} speed  m/s
 * @property {Float64Array} dist   cumulative metres
 * @property {Float64Array} active cumulative active seconds (manual pauses excluded)
 * @property {Uint16Array}  seg    segment index (increments on manual resume)
 * @property {Float32Array} acc    horizontal accuracy (m)
 * @property {Float32Array} course direction of travel (deg)
 * @property {Uint8Array}   moving 1 when moving
 */

/**
 * @param {{meta:object, points:object[], states:object[], end:object|null}} journal
 * @param {string} [activityId]
 * @returns {{track: Track, info: object}}
 */
export function processJournal(journal, activityId) {
  const act = activityProfile(activityId ?? journal.meta?.activity);
  const raw = journal.points;

  // 1. Accuracy gate (relax if the gate would discard almost everything).
  let gate = act.accuracyGate;
  let pts = raw.filter((p) => p.ha == null || p.ha <= gate);
  if (pts.length < Math.min(10, raw.length * 0.5)) {
    gate = 100;
    pts = raw.filter((p) => p.ha == null || p.ha <= gate);
  }

  // 2. Drop duplicates and implausible jumps.
  const kept = [];
  for (const p of pts) {
    const prev = kept[kept.length - 1];
    if (prev) {
      const dt = (p.t - prev.t) / 1000;
      if (dt <= 0) continue;
      if ((p.seg ?? 0) === (prev.seg ?? 0)) {
        const d = haversine(prev.lat, prev.lon, p.lat, p.lon);
        if (d / dt > act.maxSpeed * 1.5 && d > (p.ha ?? 10) * 2) continue;
      }
    }
    kept.push(p);
  }

  const n = kept.length;
  const track = allocTrack(n);
  const lastT = journal.end?.t ?? (n ? kept[n - 1].t : journal.meta?.startedAt ?? 0);
  const intervals = activeIntervals(journal.states, lastT);
  const info = {
    activity: act.id,
    startedAt: journal.meta?.startedAt ?? (n ? kept[0].t : Date.now()),
    endedAt: lastT,
    hasBarometer: Boolean(journal.meta?.hasBarometer) && kept.some((p) => p.pr != null),
    rawCount: raw.length,
    activeIntervals: intervals,
    activeSeconds: intervals.reduce((s, [a, b]) => s + (b - a) / 1000, 0),
    device: journal.meta?.device ?? null,
  };
  if (n === 0) return { track, info };

  // 3. Smooth positions per segment with Kalman + RTS in local metres.
  const proj = makeProjection(kept[0].lat, kept[0].lon);
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || (kept[i].seg ?? 0) !== (kept[start].seg ?? 0)) {
      smoothSegment(kept, start, i, proj, act.processNoise, track);
      start = i;
    }
  }

  // 4. Copy scalar fields; pick altitude source.
  for (let i = 0; i < n; i++) {
    const p = kept[i];
    track.t[i] = p.t;
    track.seg[i] = p.seg ?? 0;
    track.acc[i] = p.ha ?? NaN;
    track.alt[i] = p.af ?? p.am ?? p.ae ?? NaN;
  }
  smoothAltitude(track.alt, info.hasBarometer);

  // 5. Speed: Doppler where trustworthy, else from smoothed positions.
  for (let i = 0; i < n; i++) {
    const p = kept[i];
    let v;
    if (p.sp != null && (p.sa == null || p.sa <= 1.5)) v = p.sp;
    else v = derivedSpeed(track, i);
    if (p.p) v = Math.min(v, act.stationarySpeed * 0.5);
    track.speed[i] = Math.min(Math.max(0, v), act.maxSpeed);
  }
  const speedMed = median3(track.speed);
  track.speed.set(speedMed);

  // 6. Cumulative distance, active time, course, moving flags.
  for (let i = 0; i < n; i++) {
    track.moving[i] = track.speed[i] >= act.stationarySpeed && !kept[i].p ? 1 : 0;
    if (i === 0) continue;
    const sameSeg = track.seg[i] === track.seg[i - 1];
    const d = haversine(track.lat[i - 1], track.lon[i - 1], track.lat[i], track.lon[i]);
    const counts = sameSeg && (track.speed[i] >= act.stationarySpeed * 0.5 || d > Math.max(3, (track.acc[i] || 10) * 0.5));
    track.dist[i] = track.dist[i - 1] + (counts ? d : 0);
    track.active[i] = track.active[i - 1] + (sameSeg ? (track.t[i] - track.t[i - 1]) / 1000 : 0);
  }
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    const p = kept[i];
    if (p.br != null && track.speed[i] > 1.5) track.course[i] = p.br;
    else if (a !== b) track.course[i] = bearingBetween(track.lat[a], track.lon[a], track.lat[b], track.lon[b]);
    else track.course[i] = NaN;
  }

  // Fall back to point-derived active time when state lines are missing.
  if (!intervals.length) info.activeSeconds = track.active[n - 1];

  return { track, info };
}

export function allocTrack(n) {
  return {
    n,
    t: new Float64Array(n),
    lat: new Float64Array(n),
    lon: new Float64Array(n),
    alt: new Float32Array(n),
    speed: new Float32Array(n),
    dist: new Float64Array(n),
    active: new Float64Array(n),
    seg: new Uint16Array(n),
    acc: new Float32Array(n),
    course: new Float32Array(n),
    moving: new Uint8Array(n),
  };
}

function smoothSegment(kept, from, to, proj, q, track) {
  const m = to - from;
  const ts = new Float64Array(m);
  const xs = new Float64Array(m);
  const ys = new Float64Array(m);
  const rs = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    const p = kept[from + i];
    const [x, y] = proj.toXY(p.lat, p.lon);
    ts[i] = p.t / 1000;
    xs[i] = x;
    ys[i] = y;
    rs[i] = Math.max(1, p.ha ?? 10);
  }
  const sx = smoothAxis(ts, xs, rs, q);
  const sy = smoothAxis(ts, ys, rs, q);
  for (let i = 0; i < m; i++) {
    const [lat, lon] = proj.toLatLon(sx[i], sy[i]);
    track.lat[from + i] = lat;
    track.lon[from + i] = lon;
  }
}

function derivedSpeed(track, i) {
  const n = track.n;
  let a = i;
  let b = i;
  // Widen to ±2 samples within the same segment.
  for (let k = 0; k < 2; k++) {
    if (a > 0 && track.seg[a - 1] === track.seg[i]) a--;
    if (b < n - 1 && track.seg[b + 1] === track.seg[i]) b++;
  }
  if (a === b) return 0;
  const dt = (track.t[b] - track.t[a]) / 1000;
  if (dt <= 0) return 0;
  let d = 0;
  for (let k = a + 1; k <= b; k++) d += haversine(track.lat[k - 1], track.lon[k - 1], track.lat[k], track.lon[k]);
  return d / dt;
}

function median3(arr) {
  const n = arr.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) {
      out[i] = arr[i];
      continue;
    }
    const a = arr[i - 1], b = arr[i], c = arr[i + 1];
    out[i] = Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
  }
  return out;
}

/** In place: 5-point median then 5-point moving average (wider for GNSS-only). */
export function smoothAltitude(alt, hasBarometer) {
  const n = alt.length;
  if (n < 3) return;
  // Fill gaps by carrying neighbours so filters don't propagate NaN.
  let last = NaN;
  for (let i = 0; i < n; i++) {
    if (Number.isFinite(alt[i])) last = alt[i];
    else if (Number.isFinite(last)) alt[i] = last;
  }
  let firstFinite = NaN;
  for (let i = 0; i < n; i++) if (Number.isFinite(alt[i])) { firstFinite = alt[i]; break; }
  if (!Number.isFinite(firstFinite)) return;
  for (let i = 0; i < n && !Number.isFinite(alt[i]); i++) alt[i] = firstFinite;

  const med = new Float32Array(n);
  const w = 2;
  const buf = [];
  for (let i = 0; i < n; i++) {
    buf.length = 0;
    for (let k = Math.max(0, i - w); k <= Math.min(n - 1, i + w); k++) buf.push(alt[k]);
    buf.sort((a, b) => a - b);
    med[i] = buf[buf.length >> 1];
  }
  const avgW = hasBarometer ? 2 : 4;
  for (let i = 0; i < n; i++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - avgW); k <= Math.min(n - 1, i + avgW); k++) {
      s += med[k];
      c++;
    }
    alt[i] = s / c;
  }
}

/** Interpolate track fields at a cumulative distance. */
export function sampleAtDistance(track, d) {
  const { n, dist } = track;
  if (!n) return null;
  if (d <= dist[0]) return sampleAt(track, 0, 0);
  if (d >= dist[n - 1]) return sampleAt(track, n - 1, 0);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (dist[mid] <= d) lo = mid;
    else hi = mid;
  }
  const span = dist[hi] - dist[lo];
  const f = span > 0 ? (d - dist[lo]) / span : 0;
  return sampleAt(track, lo, f);
}

/** Interpolated sample between index i and i+1 at fraction f. */
export function sampleAt(track, i, f) {
  const j = Math.min(track.n - 1, i + 1);
  const lerp = (arr) => arr[i] + (arr[j] - arr[i]) * f;
  return {
    index: f < 0.5 ? i : j,
    t: lerp(track.t),
    lat: lerp(track.lat),
    lon: lerp(track.lon),
    alt: lerp(track.alt),
    speed: lerp(track.speed),
    dist: lerp(track.dist),
    active: lerp(track.active),
    course: track.course[i],
  };
}

// Workout statistics computed from a processed track.

import { activity as activityProfile } from '../activities.js';
import { bbox as computeBbox, makeProjection, simplifyIndices } from '../geo/geo.js';
import { heartRateStats } from './physio.js';

export const STATIONARY_MIN_SECONDS = 5;

/** Hysteresis threshold (m) for counting climbs/descents. */
export function verticalThreshold(hasBarometer) {
  return hasBarometer ? 3 : 8;
}

/**
 * Elevation gain/loss with hysteresis so sensor noise does not accumulate.
 * @returns {{gain:number, loss:number}}
 */
export function verticalGainLoss(alt, threshold, from = 0, to = alt.length) {
  let gain = 0;
  let loss = 0;
  let i = from;
  while (i < to && !Number.isFinite(alt[i])) i++;
  if (i >= to) return { gain, loss };
  let ref = alt[i];
  let dir = 0; // 1 climbing, -1 descending, 0 unknown
  for (; i < to; i++) {
    const a = alt[i];
    if (!Number.isFinite(a)) continue;
    if (dir === 1) {
      if (a > ref) {
        gain += a - ref;
        ref = a;
      } else if (ref - a >= threshold) {
        loss += ref - a;
        ref = a;
        dir = -1;
      }
    } else if (dir === -1) {
      if (a < ref) {
        loss += ref - a;
        ref = a;
      } else if (a - ref >= threshold) {
        gain += a - ref;
        ref = a;
        dir = 1;
      }
    } else if (a - ref >= threshold) {
      gain += a - ref;
      ref = a;
      dir = 1;
    } else if (ref - a >= threshold) {
      loss += ref - a;
      ref = a;
      dir = -1;
    }
  }
  return { gain, loss };
}

/** Seconds spent stationary in runs of at least STATIONARY_MIN_SECONDS. */
export function stationarySeconds(track) {
  const { n, t, seg, moving } = track;
  let total = 0;
  let run = 0;
  for (let i = 1; i < n; i++) {
    const still = seg[i] === seg[i - 1] && !moving[i] && !moving[i - 1];
    if (still) run += (t[i] - t[i - 1]) / 1000;
    if (!still || i === n - 1) {
      if (run >= STATIONARY_MIN_SECONDS) total += run;
      run = 0;
    }
  }
  return total;
}

/**
 * Per-split statistics. Splits end at every `splitLen` metres; the last split may be partial.
 */
export function computeSplits(track, splitLen, hasBarometer) {
  const { n, dist, active, alt, speed } = track;
  if (n < 2) return [];
  const total = dist[n - 1];
  const th = verticalThreshold(hasBarometer);
  const splits = [];
  let startIdx = 0;
  let startD = 0;
  let startT = 0;
  let startAlt = alt[0];
  let k = 1;
  for (let i = 1; i < n; i++) {
    while (dist[i] >= k * splitLen) {
      const target = k * splitLen;
      const span = dist[i] - dist[i - 1];
      const f = span > 0 ? (target - dist[i - 1]) / span : 1;
      const tAt = active[i - 1] + (active[i] - active[i - 1]) * f;
      const altAt = alt[i - 1] + (alt[i] - alt[i - 1]) * f;
      splits.push(makeSplit(k, startD, target, startT, tAt, startAlt, altAt, alt, speed, startIdx, i + 1, th, false, track.hr));
      startIdx = i;
      startD = target;
      startT = tAt;
      startAlt = altAt;
      k++;
    }
  }
  if (total - startD >= Math.min(50, splitLen * 0.05)) {
    splits.push(makeSplit(k, startD, total, startT, active[n - 1], startAlt, alt[n - 1], alt, speed, startIdx, n, th, true, track.hr));
  }
  return splits;
}

function makeSplit(index, d0, d1, t0, t1, alt0, alt1, alt, speed, from, to, th, partial = false, hr = null) {
  const distance = d1 - d0;
  const time = Math.max(0, t1 - t0);
  const { gain, loss } = verticalGainLoss(alt, th, from, to);
  let maxSpeed = 0;
  for (let i = from; i < to; i++) if (speed[i] > maxSpeed) maxSpeed = speed[i];
  let hrSum = 0;
  let hrCount = 0;
  let hrMax = 0;
  if (hr) {
    for (let i = from; i < to; i++) {
      if (!Number.isFinite(hr[i])) continue;
      hrSum += hr[i];
      hrCount++;
      if (hr[i] > hrMax) hrMax = hr[i];
    }
  }
  return {
    index,
    startDistance: d0,
    endDistance: d1,
    distance,
    time,
    avgSpeed: time > 0 ? distance / time : 0,
    maxSpeed,
    elevChange: Number.isFinite(alt1 - alt0) ? alt1 - alt0 : 0,
    elevGain: gain,
    elevLoss: loss,
    avgHr: hrCount ? hrSum / hrCount : null,
    maxHr: hrCount ? hrMax : null,
    partial,
  };
}

/**
 * Lift vs descent segmentation for skiing.
 * A lift is a sustained climb (> 0.2 m/s over 30 s windows) lasting ≥ 60 s and gaining ≥ 30 m.
 */
export function analyzeSki(track, hasBarometer) {
  const { n, t, alt, speed } = track;
  const climbing = new Uint8Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    while (j < i && t[i] - t[j] > 30000) j++;
    const dt = (t[i] - t[j]) / 1000;
    if (dt >= 10 && (alt[i] - alt[j]) / dt > 0.2) {
      for (let k = j; k <= i; k++) climbing[k] = 1;
    }
  }
  const lifts = [];
  let s = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && climbing[i]) {
      if (s < 0) s = i;
    } else if (s >= 0) {
      const e = i - 1;
      if ((t[e] - t[s]) / 1000 >= 60 && alt[e] - alt[s] >= 30) lifts.push([s, e]);
      s = -1;
    }
  }
  // Runs are the stretches between lifts.
  const th = verticalThreshold(hasBarometer);
  const runs = [];
  let cursor = 0;
  const bounds = [...lifts, [n, n]];
  for (const [ls, le] of bounds) {
    if (ls - cursor > 1) {
      const { loss } = verticalGainLoss(alt, th, cursor, ls);
      if (loss >= 30) {
        let maxSpeed = 0;
        for (let k = cursor; k < ls; k++) if (speed[k] > maxSpeed) maxSpeed = speed[k];
        runs.push({
          from: cursor,
          to: ls - 1,
          vertical: loss,
          distance: track.dist[ls - 1] - track.dist[cursor],
          time: (t[ls - 1] - t[cursor]) / 1000,
          maxSpeed,
        });
      }
    }
    cursor = le + 1;
  }
  const liftSeconds = lifts.reduce((acc, [a, b]) => acc + (t[b] - t[a]) / 1000, 0);
  return {
    runs: runs.length,
    lifts: lifts.length,
    liftSeconds,
    descentVertical: runs.reduce((acc, r) => acc + r.vertical, 0),
    longestRun: runs.reduce((acc, r) => Math.max(acc, r.distance), 0),
    maxRunSpeed: runs.reduce((acc, r) => Math.max(acc, r.maxSpeed), 0),
    runList: runs,
    liftList: lifts,
  };
}

/** Summary stats stored with the workout (unit-independent). */
export function computeSummary(track, info) {
  const act = activityProfile(info.activity);
  const { n } = track;
  const distance = n ? track.dist[n - 1] : 0;
  const duration = info.activeSeconds || (n ? track.active[n - 1] : 0);
  const stationaryTime = Math.min(duration, stationarySeconds(track));
  const movingTime = Math.max(0, duration - stationaryTime);
  let maxSpeed = 0;
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  for (let i = 0; i < n; i++) {
    if (track.speed[i] > maxSpeed) maxSpeed = track.speed[i];
    const a = track.alt[i];
    if (Number.isFinite(a)) {
      if (a < minAlt) minAlt = a;
      if (a > maxAlt) maxAlt = a;
    }
  }
  const hasAlt = Number.isFinite(minAlt);
  const { gain, loss } = verticalGainLoss(track.alt, verticalThreshold(info.hasBarometer));
  const summary = {
    distance,
    duration,
    totalTime: Math.max(0, (info.endedAt - info.startedAt) / 1000),
    movingTime,
    stationaryTime,
    avgSpeed: duration > 0 ? distance / duration : 0,
    avgMovingSpeed: movingTime > 0 ? distance / movingTime : 0,
    maxSpeed,
    elevGain: gain,
    elevLoss: loss,
    netVertical: hasAlt && n ? track.alt[n - 1] - track.alt[0] : 0,
    minAlt: hasAlt ? minAlt : null,
    maxAlt: hasAlt ? maxAlt : null,
    pointCount: n,
    segments: n ? track.seg[n - 1] - track.seg[0] + 1 : 0,
    hasBarometer: info.hasBarometer,
    bbox: n ? computeBbox(track.lat, track.lon, n) : null,
  };
  const hr = heartRateStats(track);
  if (hr) summary.heartRate = { avg: hr.avg, max: hr.max };
  if (act.id === 'ski' && n > 2) {
    const ski = analyzeSki(track, info.hasBarometer);
    summary.ski = {
      runs: ski.runs,
      lifts: ski.lifts,
      liftSeconds: ski.liftSeconds,
      descentVertical: ski.descentVertical,
      longestRun: ski.longestRun,
      maxRunSpeed: ski.maxRunSpeed,
    };
  }
  return summary;
}

/** Simplified [lon, lat] polyline for list thumbnails. */
export function previewPolyline(track, maxPoints = 120) {
  const { n } = track;
  if (n === 0) return [];
  const proj = makeProjection(track.lat[0], track.lon[0]);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) [xs[i], ys[i]] = proj.toXY(track.lat[i], track.lon[i]);
  let tol = 2;
  let idx = simplifyIndices(xs, ys, tol);
  while (idx.length > maxPoints && tol < 5000) {
    tol *= 2;
    idx = simplifyIndices(xs, ys, tol);
  }
  return idx.map((i) => [round6(track.lon[i]), round6(track.lat[i])]);
}

const round6 = (v) => Math.round(v * 1e6) / 1e6;

/** Indices + interpolated samples at each whole split distance (map/3D markers). */
export function distanceMarkers(track, splitLen) {
  const { n, dist } = track;
  const out = [];
  if (n < 2) return out;
  const total = dist[n - 1];
  let i = 1;
  for (let k = 1; k * splitLen <= total; k++) {
    const target = k * splitLen;
    while (i < n - 1 && dist[i] < target) i++;
    const span = dist[i] - dist[i - 1];
    const f = span > 0 ? (target - dist[i - 1]) / span : 0;
    const lerp = (a) => a[i - 1] + (a[i] - a[i - 1]) * f;
    out.push({
      k,
      index: f < 0.5 ? i - 1 : i,
      dist: target,
      t: lerp(track.t),
      active: lerp(track.active),
      lat: lerp(track.lat),
      lon: lerp(track.lon),
      alt: lerp(track.alt),
      hr: track.hr ? lerp(track.hr) : NaN,
    });
  }
  return out;
}

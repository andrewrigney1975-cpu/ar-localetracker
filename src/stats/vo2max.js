// VO2max estimate from steady walking or running with watch heart rate (docs/plans/vo2max.md).
//
// HUNT 3 submaximal model (Loe et al. 2016, PLoS ONE 11:e0144873; ~4,600 adults, 92% walked
// at the submaximal stage): VO2peak from speed, incline, weight, age and the heart rate at a
// steady submaximal stage, as a fraction of the study's age-predicted peak heart rate.
// SEE 6.24 (men) / 5.17 (women) ml·kg⁻¹·min⁻¹, about 14%.
//
// Each workout is cut into steady 5-minute stretches after a 10-minute warm-up (the study
// warmed up for 10 minutes and read the heart rate once VO2 was steady, after 3 minutes).
// Every stretch must pass speed, slope and heart-rate checks; the workout's estimate is the
// median of the stretches that pass, after dropping outliers.

import { ageAt } from './physio.js';

export const VO2_ACTIVITIES = ['walk', 'run'];
const WARMUP_S = 600;
const WINDOW_S = 300;
/** Heart rate is read over the end of each stretch, once it has settled. */
const HR_SETTLE_S = 120;
const MAX_GAP_S = 10;
const MIN_SPEED = 0.8; // m/s, about 3 km/h
const MAX_SPEED_CV = 0.15;
const MIN_GRADE = -0.02;
const MAX_GRADE = 0.08;
const MIN_HR_COVERAGE = 0.8;
const MAX_HR_SD = 8;
/** A jump this big between samples ≤ 2 s apart is an optical glitch or a lock onto cadence. */
const HR_JUMP = 15;
/** Below this fraction of peak heart rate the stage is submaximal (below the ventilatory threshold). */
const MAX_HR_FRACTION = 0.85;
const MIN_HR_ABOVE_REST = 15;
const MIN_WINDOWS = 2;
/** Stretches further than this many MADs from the workout's median are dropped. */
const OUTLIER_MADS = 3;
/** The MAD is at least this (ml·kg⁻¹·min⁻¹), so tightly agreeing stretches aren't culled. */
const MIN_MAD = 1;

/** The study's age-predicted peak heart rate. */
export function huntPeakHr(sex, age) {
  return sex === 'female' ? 212.497 - 0.702 * age : 215.336 - 0.73 * age;
}

/**
 * HUNT 3 submaximal model, ml·kg⁻¹·min⁻¹.
 * @param {{sex:'male'|'female', age:number, weightKg:number, kmh:number, inclinePct:number, hr:number}} p
 */
export function huntSubmaxVo2({ sex, age, weightKg, kmh, inclinePct, hr }) {
  const f = hr / huntPeakHr(sex, age);
  return sex === 'female'
    ? 23.77 + 1.205 * inclinePct + 6.051 * kmh - 0.16 * weightKg - 20.671 * f
    : 35.25 + 1.276 * inclinePct + 6.402 * kmh - 0.196 * weightKg - 27.615 * f;
}

/** Sex, age and weight are needed; resting and max heart rate are optional. */
export function vo2Available(profile, atMs) {
  return (profile?.sex === 'male' || profile?.sex === 'female') && Boolean(ageAt(profile, atMs)) && Number(profile?.weightKg) > 0;
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function quantile(xs, q) {
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (pos - lo);
}

/**
 * Steady stretches of a track: WINDOW_S of continuous moving samples in one segment, after
 * the warm-up, not overlapping. Returns [from, to] sample indices.
 */
export function steadyWindows(track) {
  const out = [];
  let a = -1;
  for (let i = 0; i < track.n; i++) {
    const ok = track.moving[i] && (track.active?.[i] ?? (track.t[i] - track.t[0]) / 1000) >= WARMUP_S;
    const joined = a >= 0 && track.seg[i] === track.seg[a] && (track.t[i] - track.t[i - 1]) / 1000 <= MAX_GAP_S;
    if (!ok) {
      a = -1;
      continue;
    }
    if (!joined) a = i;
    if ((track.t[i] - track.t[a]) / 1000 >= WINDOW_S) {
      out.push([a, i]);
      a = -1;
    }
  }
  return out;
}

/**
 * Check one stretch and estimate from it.
 * @returns {{vo2:number, kmh:number, inclinePct:number, hr:number} | {reject:string}}
 */
export function checkWindow(track, a, b, { sex, age, weightKg, restingHr, peakHr }) {
  const dur = (track.t[b] - track.t[a]) / 1000;
  const dist = track.dist[b] - track.dist[a];
  const v = dist / dur;
  if (!(v >= MIN_SPEED)) return { reject: 'slow' };
  let sum = 0;
  let sq = 0;
  for (let i = a; i <= b; i++) {
    sum += track.speed[i];
    sq += track.speed[i] * track.speed[i];
  }
  const n = b - a + 1;
  const mean = sum / n;
  const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
  if (sd / mean > MAX_SPEED_CV) return { reject: 'speed' };
  const rise = track.alt[b] - track.alt[a];
  const grade = Number.isFinite(rise) && dist > 0 ? rise / dist : 0;
  if (grade < MIN_GRADE || grade > MAX_GRADE) return { reject: 'slope' };

  if (!track.hr) return { reject: 'hr-missing' };
  const from = track.t[b] - HR_SETTLE_S * 1000;
  let hrN = 0;
  let hrSum = 0;
  let hrSq = 0;
  let total = 0;
  let prev = -1;
  for (let i = a; i <= b; i++) {
    if (track.t[i] < from) continue;
    total++;
    const h = track.hr[i];
    if (!Number.isFinite(h)) continue;
    if (prev >= 0 && track.t[i] - track.t[prev] <= 2000 && Math.abs(h - track.hr[prev]) >= HR_JUMP) return { reject: 'hr-jumps' };
    prev = i;
    hrN++;
    hrSum += h;
    hrSq += h * h;
  }
  if (!total || hrN / total < MIN_HR_COVERAGE) return { reject: 'hr-missing' };
  const hr = hrSum / hrN;
  if (Math.sqrt(Math.max(0, hrSq / hrN - hr * hr)) > MAX_HR_SD) return { reject: 'hr-unsteady' };
  if (hr < restingHr + MIN_HR_ABOVE_REST) return { reject: 'hr-low' };
  if (hr > MAX_HR_FRACTION * peakHr) return { reject: 'hr-high' };

  const kmh = v * 3.6;
  // The model is from treadmill inclines (≥ 0); a slight downhill counts as flat.
  const inclinePct = Math.max(0, grade) * 100;
  return { vo2: huntSubmaxVo2({ sex, age, weightKg, kmh, inclinePct, hr }), kmh, inclinePct, hr };
}

/**
 * VO2max estimate for one workout.
 * @returns {{value:number, low:number, high:number, windows:number, checked:number, rejected:Record<string, number>}
 *   | {value:null, reason:'activity'|'profile'|'no-hr'|'no-steady', checked:number, rejected:Record<string, number>}}
 */
export function workoutVo2max(track, activity, profile, atMs) {
  const rejected = {};
  if (!VO2_ACTIVITIES.includes(activity)) return { value: null, reason: 'activity', checked: 0, rejected };
  if (!vo2Available(profile, atMs)) return { value: null, reason: 'profile', checked: 0, rejected };
  if (!track?.hr) return { value: null, reason: 'no-hr', checked: 0, rejected };
  const sex = profile.sex;
  const age = ageAt(profile, atMs);
  const opts = {
    sex,
    age,
    weightKg: Number(profile.weightKg),
    restingHr: Number(profile.restingHr) > 0 ? Number(profile.restingHr) : 60,
    peakHr: Number(profile.maxHr) > 0 ? Number(profile.maxHr) : huntPeakHr(sex, age),
  };
  const windows = steadyWindows(track);
  const ok = [];
  for (const [a, b] of windows) {
    const r = checkWindow(track, a, b, opts);
    if (r.reject) rejected[r.reject] = (rejected[r.reject] ?? 0) + 1;
    else ok.push(r.vo2);
  }
  let kept = ok;
  if (ok.length >= 3) {
    const m = median(ok);
    const mad = Math.max(MIN_MAD, median(ok.map((x) => Math.abs(x - m))));
    kept = ok.filter((x) => Math.abs(x - m) <= OUTLIER_MADS * mad);
    if (kept.length < ok.length) rejected.outlier = ok.length - kept.length;
  }
  if (kept.length < MIN_WINDOWS) return { value: null, reason: 'no-steady', checked: windows.length, rejected };
  return {
    value: median(kept),
    low: quantile(kept, 0.25),
    high: quantile(kept, 0.75),
    windows: kept.length,
    checked: windows.length,
    rejected,
  };
}

/**
 * Current estimate: the median of the workout estimates in the last `days` days, so one
 * off day (or a bad heart-rate reading) doesn't move it.
 * @param {{at:number, value:number}[]} entries
 * @returns {{value:number, count:number, min:number, max:number} | null}
 */
export function currentVo2max(entries, now, days = 28) {
  const from = now - days * 86400000;
  const vs = entries.filter((e) => e.at >= from && e.at <= now && Number.isFinite(e.value)).map((e) => e.value);
  if (!vs.length) return null;
  return { value: median(vs), count: vs.length, min: Math.min(...vs), max: Math.max(...vs) };
}

const REASONS = {
  slow: 'too slow',
  speed: 'uneven pace',
  slope: 'too steep',
  'hr-missing': 'heart rate missing',
  'hr-jumps': 'heart-rate jumps',
  'hr-unsteady': 'heart rate unsteady',
  'hr-low': 'heart rate too low',
  'hr-high': 'heart rate too high',
  outlier: 'out of line',
};

/** "uneven pace 3, heart-rate jumps 1": why stretches were left out, most common first. */
export function rejectedText(rejected) {
  return Object.entries(rejected)
    .sort((x, y) => y[1] - x[1])
    .map(([k, n]) => `${REASONS[k] ?? k} ${n}`)
    .join(', ');
}

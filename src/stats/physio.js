// Heart-rate zones, training load and calorie estimates.
//
// - Max HR: user value, else Tanaka et al. (2001): 208 − 0.7 × age.
// - Zones: % of heart-rate reserve (Karvonen), the same basis as TRIMP.
// - Cardio load: Banister TRIMP — Σ minutes × HRr × a·e^(b·HRr), a/b by sex.
// - Calories with HR: Keytel et al. (2005), J Sports Sci 23(3):289-297 (no VO2max form).
// - Calories without HR: ACSM walking/running equations, Compendium METs for cycling/skiing.

const SAMPLE_GAP_S = 10; // ignore gaps longer than this between samples

export const ZONES = [
  { id: 1, label: 'Easy', lo: 0.5, color: '#94a3b8' },
  { id: 2, label: 'Fat burn', lo: 0.6, color: '#3b82f6' },
  { id: 3, label: 'Aerobic', lo: 0.7, color: '#22c55e' },
  { id: 4, label: 'Threshold', lo: 0.8, color: '#f59e0b' },
  { id: 5, label: 'Max', lo: 0.9, color: '#ef4444' },
];

export function ageAt(profile, atMs = Date.now()) {
  const y = Number(profile?.birthYear);
  if (!y) return null;
  return new Date(atMs).getFullYear() - y;
}

export function maxHeartRate(profile, atMs) {
  if (Number(profile?.maxHr) > 0) return Number(profile.maxHr);
  const age = ageAt(profile, atMs);
  return age ? Math.round(208 - 0.7 * age) : null;
}

export function restingHeartRate(profile) {
  return Number(profile?.restingHr) > 0 ? Number(profile.restingHr) : 60;
}

/** Profile fields required for calories (weight, age, sex). */
export function profileComplete(profile) {
  return Boolean(Number(profile?.weightKg) > 0 && ageAt(profile) && (profile?.sex === 'male' || profile?.sex === 'female'));
}

/** Iterate (dt seconds, sample index) over consecutive points in the same segment. */
function* intervals(track) {
  for (let i = 1; i < track.n; i++) {
    if (track.seg[i] !== track.seg[i - 1]) continue;
    const dt = (track.t[i] - track.t[i - 1]) / 1000;
    if (dt > 0 && dt <= SAMPLE_GAP_S) yield [dt, i];
  }
}

/** Time-weighted average and max heart rate over samples that have HR. */
export function heartRateStats(track) {
  if (!track.hr) return null;
  let sum = 0;
  let time = 0;
  let max = 0;
  for (const [dt, i] of intervals(track)) {
    const h = track.hr[i];
    if (!Number.isFinite(h)) continue;
    sum += h * dt;
    time += dt;
  }
  // Max from a 5-sample median to ignore single-sample optical glitches.
  const hr = track.hr;
  for (let i = 2; i < track.n - 2; i++) {
    const w = [hr[i - 2], hr[i - 1], hr[i], hr[i + 1], hr[i + 2]].filter(Number.isFinite).sort((a, b) => a - b);
    if (w.length >= 3) max = Math.max(max, w[w.length >> 1]);
  }
  if (!time) return null;
  return { avg: sum / time, max: max || null, seconds: time };
}

/** Seconds per zone (index 0 = below zone 1), based on % heart-rate reserve. */
export function zoneSeconds(track, profile, atMs) {
  const max = maxHeartRate(profile, atMs);
  if (!track.hr || !max) return null;
  const rest = restingHeartRate(profile);
  const out = new Array(ZONES.length + 1).fill(0);
  for (const [dt, i] of intervals(track)) {
    const h = track.hr[i];
    if (!Number.isFinite(h)) continue;
    const r = (h - rest) / (max - rest);
    let z = 0;
    for (let k = ZONES.length - 1; k >= 0; k--) {
      if (r >= ZONES[k].lo) {
        z = k + 1;
        break;
      }
    }
    out[z] += dt;
  }
  return out;
}

/** Banister TRIMP (training impulse). */
export function trimp(track, profile, atMs) {
  const max = maxHeartRate(profile, atMs);
  if (!track.hr || !max) return null;
  const rest = restingHeartRate(profile);
  const [a, b] = profile?.sex === 'female' ? [0.86, 1.67] : profile?.sex === 'male' ? [0.64, 1.92] : [0.75, 1.8];
  let load = 0;
  let any = false;
  for (const [dt, i] of intervals(track)) {
    const h = track.hr[i];
    if (!Number.isFinite(h)) continue;
    any = true;
    const r = Math.min(1, Math.max(0, (h - rest) / (max - rest)));
    load += (dt / 60) * r * a * Math.exp(b * r);
  }
  return any ? load : null;
}

/** Keytel (2005) energy expenditure, kcal per minute. */
export function keytelKcalPerMin(hr, weightKg, age, sex) {
  const kj =
    sex === 'female'
      ? -20.4022 + 0.4472 * hr - 0.1263 * weightKg + 0.074 * age
      : -55.0969 + 0.6309 * hr + 0.1988 * weightKg + 0.2017 * age;
  return Math.max(0, kj / 4.184);
}

/** Grade (rise/run) around sample i over ~±25 m. */
function gradeAt(track, i) {
  let a = i;
  let b = i;
  while (a > 0 && track.dist[i] - track.dist[a] < 25 && track.seg[a - 1] === track.seg[i]) a--;
  while (b < track.n - 1 && track.dist[b] - track.dist[i] < 25 && track.seg[b + 1] === track.seg[i]) b++;
  const run = track.dist[b] - track.dist[a];
  return run > 5 ? (track.alt[b] - track.alt[a]) / run : 0;
}

/** Metabolic equivalent for one sample without heart rate. */
export function metAt(track, i, activity) {
  const v = track.speed[i];
  if (!track.moving[i]) return 1.3;
  const vmin = v * 60;
  const grade = Math.max(0, Math.min(0.25, Number.isFinite(track.alt[i]) ? gradeAt(track, i) : 0));
  switch (activity) {
    case 'walk':
    case 'run': {
      // ACSM: running above ~8 km/h (or for run workouts above a slow jog), walking otherwise.
      const running = v > 2.2 || (activity === 'run' && v > 1.8);
      const vo2 = running ? 0.2 * vmin + 0.9 * vmin * grade + 3.5 : 0.1 * vmin + 1.8 * vmin * grade + 3.5;
      return vo2 / 3.5;
    }
    case 'cycle': {
      const kmh = v * 3.6;
      return kmh < 16 ? 4 : kmh < 19 ? 6.8 : kmh < 22 ? 8 : kmh < 25.6 ? 10 : kmh < 30.6 ? 12 : 15.8;
    }
    case 'ski':
      return 5.3;
    default:
      return 4;
  }
}

/**
 * Estimated active calories. Uses heart rate where available (≥ 90 bpm, the Keytel model's
 * useful range) and activity/speed/grade elsewhere.
 * @returns {{kcal:number, method:'heart-rate'|'mixed'|'activity'}|null} null without a complete profile
 */
export function estimateCalories(track, activity, profile, atMs) {
  if (!profileComplete(profile)) return null;
  const weight = Number(profile.weightKg);
  const age = ageAt(profile, atMs);
  let kcal = 0;
  let hrTime = 0;
  let total = 0;
  for (const [dt, i] of intervals(track)) {
    total += dt;
    const h = track.hr ? track.hr[i] : NaN;
    if (Number.isFinite(h) && h >= 90) {
      kcal += (keytelKcalPerMin(h, weight, age, profile.sex) * dt) / 60;
      hrTime += dt;
    } else {
      kcal += (metAt(track, i, activity) * weight * dt) / 3600;
    }
  }
  if (!total) return null;
  const share = hrTime / total;
  return { kcal, method: share > 0.9 ? 'heart-rate' : share > 0 ? 'mixed' : 'activity' };
}

/** Plain-language label for a TRIMP value (per-workout scale). */
export function loadLabel(value) {
  if (value == null) return '';
  if (value < 50) return 'Light';
  if (value < 120) return 'Moderate';
  if (value < 250) return 'Hard';
  return 'Very hard';
}

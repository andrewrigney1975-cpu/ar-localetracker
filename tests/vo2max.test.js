import { describe, expect, it } from 'vitest';
import { currentVo2max, huntPeakHr, huntSubmaxVo2, rejectedText, steadyWindows, workoutVo2max } from '../src/stats/vo2max.js';

const AT = Date.UTC(2026, 9, 20);
const MAN = { sex: 'male', birthYear: 1975, weightKg: 93, restingHr: 53 }; // 51 in 2026
const WOMAN = { sex: 'female', birthYear: 1985, weightKg: 62, restingHr: 58 }; // 41

/**
 * A 1 Hz track. speed/hr/alt are functions of the second; `pause` is [from, to) seconds
 * not moving; `seg` returns the segment for a second.
 */
function makeTrack({ seconds = 3600, speed = () => 2.03, hr = () => 135, alt = () => 10, pause = null, seg = () => 0 } = {}) {
  const n = seconds + 1;
  const t = new Float64Array(n);
  const dist = new Float64Array(n);
  const sp = new Float32Array(n);
  const al = new Float32Array(n);
  const h = new Float32Array(n);
  const moving = new Uint8Array(n);
  const sg = new Uint16Array(n);
  const active = new Float64Array(n);
  for (let s = 0; s < n; s++) {
    t[s] = AT + s * 1000;
    const still = pause && s >= pause[0] && s < pause[1];
    sp[s] = still ? 0 : speed(s);
    moving[s] = still ? 0 : 1;
    dist[s] = s ? dist[s - 1] + sp[s] : 0;
    al[s] = alt(s);
    h[s] = hr(s);
    sg[s] = seg(s);
    active[s] = s ? active[s - 1] + 1 : 0;
  }
  return { n, t, dist, speed: sp, alt: al, hr: h, moving, seg: sg, active };
}

describe('HUNT submaximal model', () => {
  it('matches the published equations', () => {
    // Men: 35.25 + 1.276·i + 6.402·v − 0.196·kg − 27.615·HR/(215.336 − 0.73·age)
    expect(huntSubmaxVo2({ sex: 'male', age: 51, weightKg: 93, kmh: 7.3, inclinePct: 0, hr: 135 })).toBeCloseTo(42.83, 2);
    expect(huntSubmaxVo2({ sex: 'male', age: 51, weightKg: 93, kmh: 7.3, inclinePct: 2, hr: 135 })).toBeCloseTo(42.83 + 2.552, 2);
    // Women: 23.77 + 1.205·i + 6.051·v − 0.160·kg − 20.671·HR/(212.497 − 0.702·age)
    expect(huntSubmaxVo2({ sex: 'female', age: 41, weightKg: 62, kmh: 6, inclinePct: 0, hr: 120 })).toBeCloseTo(23.77 + 36.306 - 9.92 - (20.671 * 120) / (212.497 - 0.702 * 41), 6);
    expect(huntPeakHr('male', 51)).toBeCloseTo(178.106, 3);
  });
});

describe('steady stretches', () => {
  it('starts after a 10-minute warm-up and does not overlap', () => {
    const w = steadyWindows(makeTrack({ seconds: 1800 }));
    expect(w.map(([a, b]) => [a, b])).toEqual([
      [600, 900],
      [901, 1201],
      [1202, 1502],
    ]);
  });

  it('breaks at a pause or a new segment', () => {
    const w = steadyWindows(makeTrack({ seconds: 1800, pause: [800, 820] }));
    expect(w[0][0]).toBe(820);
    const s = steadyWindows(makeTrack({ seconds: 1800, seg: (x) => (x < 1000 ? 0 : 1) }));
    expect(s.map(([a]) => a)).toEqual([600, 1000, 1301]);
  });
});

describe('workout estimate', () => {
  it('estimates from steady walking with steady heart rate', () => {
    const r = workoutVo2max(makeTrack(), 'walk', MAN, AT);
    expect(r.value).toBeCloseTo(huntSubmaxVo2({ sex: 'male', age: 51, weightKg: 93, kmh: 2.03 * 3.6, inclinePct: 0, hr: 135 }), 3);
    expect(r.windows).toBe(r.checked);
    expect(r.checked).toBe(9);
    expect(rejectedText(r.rejected)).toBe('');
    const f = workoutVo2max(makeTrack({ speed: () => 1.7, hr: () => 125 }), 'walk', WOMAN, AT);
    expect(f.value).toBeGreaterThan(20);
  });

  it('uses the climb, and leaves out steep or downhill stretches', () => {
    const up = workoutVo2max(makeTrack({ alt: (s) => s * 2.03 * 0.03 }), 'walk', MAN, AT); // 3% up
    expect(up.value).toBeCloseTo(huntSubmaxVo2({ sex: 'male', age: 51, weightKg: 93, kmh: 2.03 * 3.6, inclinePct: 3, hr: 135 }), 1);
    const steep = workoutVo2max(makeTrack({ alt: (s) => s * 2.03 * 0.1 }), 'walk', MAN, AT);
    expect(steep).toMatchObject({ value: null, reason: 'no-steady', rejected: { slope: 9 } });
    const down = workoutVo2max(makeTrack({ alt: (s) => -s * 2.03 * 0.05 }), 'walk', MAN, AT);
    expect(down.rejected.slope).toBe(9);
  });

  it('leaves out uneven pace', () => {
    const r = workoutVo2max(makeTrack({ speed: (s) => (s % 20 < 10 ? 1.2 : 2.8) }), 'walk', MAN, AT);
    expect(r).toMatchObject({ value: null, reason: 'no-steady', rejected: { speed: 9 } });
  });

  it('checks the heart rate: missing, jumps, unsteady, too low, too high', () => {
    const gaps = workoutVo2max(makeTrack({ hr: (s) => (s % 3 ? NaN : 135) }), 'walk', MAN, AT);
    expect(gaps.rejected['hr-missing']).toBe(9);
    // A sudden 20 bpm step, like a lock onto the step rate.
    const jumps = workoutVo2max(makeTrack({ hr: (s) => (s % 300 < 250 ? 115 : 135) }), 'walk', MAN, AT);
    expect(jumps.rejected['hr-jumps']).toBeGreaterThan(0);
    const wobble = workoutVo2max(makeTrack({ hr: (s) => 135 + 14 * Math.sin(s / 8) }), 'walk', MAN, AT);
    expect(wobble.rejected['hr-unsteady']).toBe(9);
    const low = workoutVo2max(makeTrack({ hr: () => 60 }), 'walk', MAN, AT);
    expect(low.rejected['hr-low']).toBe(9);
    // Above 85% of peak (178 for a 51-year-old man) is no longer submaximal.
    const high = workoutVo2max(makeTrack({ hr: () => 156 }), 'walk', MAN, AT);
    expect(high).toMatchObject({ value: null, rejected: { 'hr-high': 9 } });
    // A measured max heart rate replaces the age estimate.
    expect(workoutVo2max(makeTrack({ hr: () => 156 }), 'walk', { ...MAN, maxHr: 190 }, AT).value).not.toBeNull();
  });

  it('drops stretches out of line with the rest', () => {
    // One stretch reads 30 bpm higher (but still submaximal) than the others.
    const r = workoutVo2max(makeTrack({ hr: (s) => (s >= 1202 && s <= 1502 ? 150 : 125) }), 'walk', MAN, AT);
    expect(r.rejected.outlier).toBe(1);
    expect(r.windows).toBe(8);
    expect(r.value).toBeCloseTo(huntSubmaxVo2({ sex: 'male', age: 51, weightKg: 93, kmh: 2.03 * 3.6, inclinePct: 0, hr: 125 }), 3);
  });

  it('drops stretches where the heart rate locks onto the step rate, when only some do', () => {
    // Steps at 128/min; heart rate 128 (locked) during two of the nine stretches, else 120.
    const lockedAt = (s) => (s >= 901 && s <= 1201) || (s >= 1803 && s <= 2103);
    const t = makeTrack({ hr: (s) => (lockedAt(s) ? 128 : 120) });
    t.cad = new Float32Array(t.n).fill(128);
    t.cadSrc = new Uint8Array(t.n).fill(1);
    const r = workoutVo2max(t, 'walk', MAN, AT);
    expect(r.rejected['hr-cadence']).toBe(2);
    expect(r.windows).toBe(7);
    expect(rejectedText({ 'hr-cadence': 2 })).toBe('heart rate locked to step rate 2');
    // Heart rate near the step rate all walk is taken as genuine.
    const all = makeTrack({ hr: () => 127 });
    all.cad = new Float32Array(all.n).fill(128);
    all.cadSrc = new Uint8Array(all.n).fill(2);
    expect(workoutVo2max(all, 'walk', MAN, AT)).toMatchObject({ windows: 9, rejected: {} });
  });

  it('needs walking or running, a profile, heart rate and two stretches', () => {
    expect(workoutVo2max(makeTrack(), 'cycle', MAN, AT)).toMatchObject({ value: null, reason: 'activity' });
    // Runs are beyond the walking model, and so are jogged stretches of a walk.
    expect(workoutVo2max(makeTrack({ speed: () => 2.65, hr: () => 149 }), 'run', MAN, AT)).toMatchObject({ value: null, reason: 'activity' });
    expect(workoutVo2max(makeTrack({ speed: () => 2.5 }), 'walk', MAN, AT)).toMatchObject({ value: null, rejected: { fast: 9 } });
    expect(workoutVo2max(makeTrack(), 'walk', { ...MAN, weightKg: null }, AT)).toMatchObject({ value: null, reason: 'profile' });
    expect(workoutVo2max({ ...makeTrack(), hr: undefined }, 'walk', MAN, AT)).toMatchObject({ value: null, reason: 'no-hr' });
    expect(workoutVo2max(makeTrack({ seconds: 1100 }), 'walk', MAN, AT)).toMatchObject({ value: null, reason: 'no-steady', checked: 1 });
  });
});

describe('current estimate', () => {
  it('is the median of the last 4 weeks', () => {
    const day = 86400000;
    const entries = [
      { at: AT - 40 * day, value: 30 },
      { at: AT - 20 * day, value: 42 },
      { at: AT - 10 * day, value: 40 },
      { at: AT - 2 * day, value: 44 },
      { at: AT - day, value: null },
    ];
    expect(currentVo2max(entries, AT)).toEqual({ value: 42, count: 3, min: 40, max: 44 });
    expect(currentVo2max(entries, AT - 50 * day)).toBeNull();
  });

  it('says why stretches were left out, most common first', () => {
    expect(rejectedText({ 'hr-high': 15, 'hr-unsteady': 1, speed: 3 })).toBe('heart rate too high 15, uneven pace 3, heart rate unsteady 1');
  });
});

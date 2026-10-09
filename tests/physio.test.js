import { describe, expect, it } from 'vitest';
import { alignHeartRate, processJournal } from '../src/geo/process.js';
import { generateCalibratedCity2Surf } from '../src/seed/city2surf.js';
import {
  estimateCalories,
  heartRateStats,
  keytelKcalPerMin,
  maxHeartRate,
  metAt,
  profileComplete,
  trimp,
  zoneSeconds,
} from '../src/stats/physio.js';
import { computeSplits, computeSummary } from '../src/stats/summary.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

const profile = { birthYear: 1980, sex: 'male', weightKg: 78, restingHr: 56 };
const AT = Date.UTC(2026, 7, 9);

describe('heart rate alignment', () => {
  it('interpolates between samples and leaves gaps empty', () => {
    const hr = alignHeartRate(
      [0, 1000, 2000, 30000],
      [
        { t: 0, bpm: 100 },
        { t: 2000, bpm: 110 },
      ]
    );
    expect(hr[0]).toBe(100);
    expect(hr[1]).toBeCloseTo(105);
    expect(hr[2]).toBe(110);
    expect(Number.isNaN(hr[3])).toBe(true);
  });

  it('parses hr journal lines and attaches them to the track', () => {
    const { text } = generateJournal({ seconds: 600, heartRate: true });
    const j = parseJournal(text);
    expect(j.hr.length).toBe(600);
    const { track, info } = processJournal(j);
    expect(info.hasHeartRate).toBe(true);
    expect(track.hr.filter(Number.isFinite).length).toBe(track.n);
  });
});

describe('formulas', () => {
  it('estimates max HR with Tanaka unless set', () => {
    expect(maxHeartRate(profile, AT)).toBe(Math.round(208 - 0.7 * 46));
    expect(maxHeartRate({ ...profile, maxHr: 190 }, AT)).toBe(190);
    expect(maxHeartRate({}, AT)).toBeNull();
  });

  it('matches Keytel 2005 by hand', () => {
    // Male, 150 bpm, 78 kg, 46 y: (-55.0969 + 94.635 + 15.5064 + 9.2782) / 4.184
    expect(keytelKcalPerMin(150, 78, 46, 'male')).toBeCloseTo(15.37, 1);
    expect(keytelKcalPerMin(150, 60, 35, 'female')).toBeCloseTo(9.96, 1); // 41.69 kJ/min / 4.184
  });

  it('uses ACSM running VO2 for METs', () => {
    const track = { n: 1, speed: Float32Array.of(3), moving: Uint8Array.of(1), alt: Float32Array.of(NaN), dist: Float64Array.of(0), seg: Uint16Array.of(0) };
    // 3 m/s = 180 m/min → VO2 = 36 + 3.5 = 39.5 → 11.3 METs
    expect(metAt(track, 0, 'run')).toBeCloseTo(39.5 / 3.5, 2);
  });

  it('requires weight, age and sex for calories', () => {
    expect(profileComplete(profile)).toBe(true);
    expect(profileComplete({ ...profile, weightKg: '' })).toBe(false);
  });
});

describe('City2Surf with heart rate', () => {
  const { text } = generateCalibratedCity2Surf();
  const { track, info } = processJournal(parseJournal(text));
  const summary = computeSummary(track, info);

  it('has plausible race heart rate that peaks on Heartbreak Hill', () => {
    expect(summary.heartRate.avg).toBeGreaterThan(140);
    expect(summary.heartRate.avg).toBeLessThan(165);
    expect(summary.heartRate.max).toBeLessThan(184);
    const splits = computeSplits(track, 1000, true);
    const hill = splits[6].avgHr;
    const flat = splits[4].avgHr;
    expect(hill).toBeGreaterThan(flat + 5);
  });

  it('estimates calories, zones and TRIMP', () => {
    const kcal = estimateCalories(track, 'run', profile, AT);
    expect(kcal.method).toBe('heart-rate');
    // ~90 min of running at ~150 bpm for a 78 kg man: roughly 1,000–1,500 kcal.
    expect(kcal.kcal).toBeGreaterThan(1000);
    expect(kcal.kcal).toBeLessThan(1500);
    const zones = zoneSeconds(track, profile, AT);
    const total = zones.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(heartRateStats(track).seconds, 0);
    expect(zones[3] + zones[4]).toBeGreaterThan(total * 0.5); // mostly aerobic/threshold
    const load = trimp(track, profile, AT);
    expect(load).toBeGreaterThan(100);
    expect(load).toBeLessThan(300);
  });

  it('falls back to activity-based calories without heart rate', () => {
    const noHr = { ...track, hr: undefined };
    const kcal = estimateCalories(noHr, 'run', profile, AT);
    expect(kcal.method).toBe('activity');
    expect(kcal.kcal).toBeGreaterThan(900);
    expect(kcal.kcal).toBeLessThan(1400);
  });
});

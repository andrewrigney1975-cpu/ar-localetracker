import { describe, expect, it } from 'vitest';
import { processJournal } from '../src/geo/process.js';
import { CITY2SURF_START, generateCalibratedCity2Surf, TARGET_PACE } from '../src/seed/city2surf.js';
import { computeSplits, computeSummary } from '../src/stats/summary.js';
import { parseJournal } from '../src/tracker/journal.js';

const { text, paces, courseLength } = generateCalibratedCity2Surf();
const { track, info } = processJournal(parseJournal(text));
const summary = computeSummary(track, info);
const splits = computeSplits(track, 1000, info.hasBarometer);

describe('City2Surf sample workout', () => {
  it('follows the ~14 km course', () => {
    expect(courseLength).toBeGreaterThan(13800);
    expect(courseLength).toBeLessThan(14600);
    expect(Math.abs(summary.distance - courseLength) / courseLength).toBeLessThan(0.01);
  });

  it('starts on race morning and runs continuously', () => {
    expect(info.startedAt).toBe(CITY2SURF_START);
    expect(summary.stationaryTime).toBe(0);
    expect(summary.segments).toBe(1);
  });

  it('plans every km within ±30 s of 6:18', () => {
    paces.forEach((p) => expect(Math.abs(p - TARGET_PACE)).toBeLessThanOrEqual(30));
  });

  it('measures an average pace of 6:18 /km in the app', () => {
    const pace = summary.duration / (summary.distance / 1000);
    expect(Math.abs(pace - TARGET_PACE)).toBeLessThan(0.5);
  });

  it('measures every full km split within ±30 s of 6:18', () => {
    const full = splits.filter((s) => !s.partial);
    expect(full.length).toBe(14);
    for (const s of full) expect(Math.abs(s.time - TARGET_PACE)).toBeLessThanOrEqual(30);
  });

  it('has Heartbreak Hill: slower splits and a big climb from Rose Bay', () => {
    expect(summary.elevGain).toBeGreaterThan(120);
    expect(summary.maxAlt).toBeGreaterThan(70);
    expect(summary.minAlt).toBeLessThan(10);
    const hill = splits[6].time; // km 7
    const flat = splits[4].time; // km 5 along Double Bay / Point Piper
    expect(hill).toBeGreaterThan(flat);
  });
});

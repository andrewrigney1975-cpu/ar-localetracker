import { describe, expect, it } from 'vitest';
import { processJournal } from '../src/geo/process.js';
import {
  computeSplits,
  computeSummary,
  distanceMarkers,
  previewPolyline,
  stationarySeconds,
  verticalGainLoss,
} from '../src/stats/summary.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

function workoutFor(opts) {
  const { text, trueDistance } = generateJournal(opts);
  const { track, info } = processJournal(parseJournal(text));
  return { track, info, trueDistance, summary: computeSummary(track, info) };
}

describe('vertical gain/loss', () => {
  it('ignores noise below the hysteresis threshold', () => {
    const alt = Float32Array.from({ length: 200 }, (_, i) => 100 + (i % 2 ? 1.2 : -1.2));
    expect(verticalGainLoss(alt, 3)).toEqual({ gain: 0, loss: 0 });
  });

  it('counts a clean climb and descent', () => {
    const up = Array.from({ length: 50 }, (_, i) => 100 + i * 2);
    const down = Array.from({ length: 50 }, (_, i) => 198 - i * 2);
    const { gain, loss } = verticalGainLoss(Float32Array.from([...up, ...down]), 3);
    expect(gain).toBeCloseTo(98, 0);
    expect(loss).toBeCloseTo(98, 0);
  });
});

describe('summary', () => {
  it('produces consistent run stats', () => {
    const { summary, trueDistance } = workoutFor({ activity: 'run', seconds: 1800, seed: 3 });
    expect(summary.distance).toBeGreaterThan(trueDistance * 0.97);
    expect(summary.movingTime + summary.stationaryTime).toBeCloseTo(summary.duration, 3);
    expect(summary.stationaryTime).toBeGreaterThan(20); // the route includes stops
    expect(summary.maxSpeed).toBeGreaterThanOrEqual(summary.avgMovingSpeed);
    expect(summary.avgMovingSpeed).toBeGreaterThan(summary.avgSpeed);
    expect(summary.elevGain).toBeGreaterThan(40);
    expect(summary.maxAlt).toBeGreaterThan(summary.minAlt);
  });

  it('counts stationary only for runs of at least 5 s', () => {
    const { track } = workoutFor({ activity: 'walk', seconds: 200, stops: false });
    expect(stationarySeconds(track)).toBeLessThan(5);
  });

  it('finds ski runs and lifts', () => {
    const { summary } = workoutFor({ activity: 'ski', seconds: 2400, seed: 5 });
    expect(summary.ski.lifts).toBeGreaterThanOrEqual(2);
    expect(summary.ski.runs).toBeGreaterThanOrEqual(2);
    expect(summary.ski.descentVertical).toBeGreaterThan(500);
  });

  it('works without a barometer', () => {
    const { summary } = workoutFor({ activity: 'run', seconds: 1200, hasBarometer: false });
    expect(summary.hasBarometer).toBe(false);
    expect(summary.elevGain).toBeGreaterThan(20);
  });
});

describe('splits and markers', () => {
  it('split distances sum to the total and times to active time', () => {
    const { track, info, summary } = workoutFor({ activity: 'run', seconds: 2400 });
    const splits = computeSplits(track, 1000, info.hasBarometer);
    const dist = splits.reduce((a, s) => a + s.distance, 0);
    const time = splits.reduce((a, s) => a + s.time, 0);
    expect(dist).toBeCloseTo(summary.distance, 0);
    expect(time).toBeCloseTo(track.active[track.n - 1], 0);
    expect(splits.slice(0, -1).every((s) => Math.abs(s.distance - 1000) < 1e-6)).toBe(true);
  });

  it('places a marker at each whole split', () => {
    const { track, summary } = workoutFor({ activity: 'cycle', seconds: 1200 });
    const markers = distanceMarkers(track, 1000);
    expect(markers.length).toBe(Math.floor(summary.distance / 1000));
    markers.forEach((m, i) => expect(m.dist).toBe((i + 1) * 1000));
  });

  it('simplifies the preview polyline', () => {
    const { track } = workoutFor({ activity: 'run', seconds: 1800 });
    const pl = previewPolyline(track, 100);
    expect(pl.length).toBeLessThanOrEqual(100);
    expect(pl.length).toBeGreaterThan(5);
  });
});

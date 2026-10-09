import { Decoder, Stream } from '@garmin/fitsdk';
import { describe, expect, it } from 'vitest';
import { renderExport } from '../src/export/index.js';
import { fitCrc, FIT_EPOCH_OFFSET } from '../src/export/fit.js';
import { processJournal } from '../src/geo/process.js';
import { generateCalibratedCity2Surf } from '../src/seed/city2surf.js';
import { computeSplits, computeSummary } from '../src/stats/summary.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

const profile = { birthYear: 1980, sex: 'male', weightKg: 78, restingHr: 56 };

function decode(bytes) {
  const stream = Stream.fromByteArray(bytes);
  expect(Decoder.isFIT(stream)).toBe(true);
  const decoder = new Decoder(stream);
  expect(decoder.checkIntegrity()).toBe(true); // header + file CRC
  const { messages, errors } = decoder.read();
  expect(errors).toEqual([]);
  return messages;
}

function build(journalText, activity = 'run') {
  const { track, info } = processJournal(parseJournal(journalText));
  const workout = {
    id: 't',
    name: 'Test',
    activity,
    startedAt: info.startedAt,
    endedAt: info.endedAt,
    tzOffset: -600,
    summary: computeSummary(track, info),
  };
  return { track, workout };
}

describe('FIT export (validated with the Garmin FIT SDK)', () => {
  const { text } = generateCalibratedCity2Surf();
  const { track, workout } = build(text);
  const out = renderExport('fit', workout, track, { profile });
  const m = decode(out.content);

  it('is a binary .fit activity file', () => {
    expect(out.content).toBeInstanceOf(Uint8Array);
    expect(out.filename).toMatch(/\.fit$/);
    expect(m.fileIdMesgs[0].type).toBe('activity');
    expect(m.activityMesgs.length).toBe(1);
    expect(m.activityMesgs[0].numSessions).toBe(1);
  });

  it('has one record per track point with correct values', () => {
    expect(m.recordMesgs.length).toBe(track.n);
    const i = 2000;
    const r = m.recordMesgs[i];
    expect(r.timestamp.getTime()).toBe(Math.round(track.t[i] / 1000) * 1000);
    expect(r.positionLat / (2 ** 31 / 180)).toBeCloseTo(track.lat[i], 6);
    expect(r.positionLong / (2 ** 31 / 180)).toBeCloseTo(track.lon[i], 6);
    expect(r.altitude).toBeCloseTo(track.alt[i], 0);
    expect(r.distance).toBeCloseTo(track.dist[i], 1);
    expect(r.speed).toBeCloseTo(track.speed[i], 2);
    expect(r.heartRate).toBe(Math.round(track.hr[i]));
  });

  it('session totals match the summary', () => {
    const s = m.sessionMesgs[0];
    const sm = workout.summary;
    expect(s.sport).toBe('running');
    expect(s.totalDistance).toBeCloseTo(sm.distance, 0);
    expect(s.totalTimerTime).toBeCloseTo(sm.duration, 0);
    expect(s.avgHeartRate).toBe(Math.round(sm.heartRate.avg));
    expect(s.maxHeartRate).toBe(Math.round(sm.heartRate.max));
    expect(s.totalAscent).toBe(Math.round(sm.elevGain));
    expect(s.totalCalories).toBeGreaterThan(1000);
    expect(s.numLaps).toBe(m.lapMesgs.length);
  });

  it('has a lap per km whose distances and calories add up', () => {
    const splits = computeSplits(track, 1000, true);
    expect(m.lapMesgs.length).toBe(splits.length);
    const lapDist = m.lapMesgs.reduce((a, l) => a + l.totalDistance, 0);
    expect(lapDist).toBeCloseTo(workout.summary.distance, -1);
    expect(m.lapMesgs[6].avgHeartRate).toBe(Math.round(splits[6].avgHr));
    const lapCal = m.lapMesgs.reduce((a, l) => a + l.totalCalories, 0);
    expect(Math.abs(lapCal - m.sessionMesgs[0].totalCalories)).toBeLessThan(m.lapMesgs.length + 5);
  });

  it('marks manual pauses with timer events', () => {
    const { track: t2, workout: w2 } = build(generateJournal({ seconds: 600, pauses: [[300, 120]], heartRate: false }).text);
    const m2 = decode(renderExport('fit', w2, t2).content);
    const types = m2.eventMesgs.map((e) => `${e.event}:${e.eventType}`);
    expect(types).toEqual(['timer:start', 'timer:stopAll', 'timer:start', 'timer:stopAll']);
    expect(m2.recordMesgs[0].heartRate).toBeUndefined();
    expect(m2.sessionMesgs[0].totalCalories).toBeUndefined(); // no profile
  });

  it('maps every activity to a FIT sport', () => {
    const sports = { walk: 'walking', cycle: 'cycling', ski: 'alpineSkiing' };
    for (const [act, sport] of Object.entries(sports)) {
      const { track: t, workout: wk } = build(generateJournal({ activity: act, seconds: 200 }).text, act);
      expect(decode(renderExport('fit', wk, t).content).sessionMesgs[0].sport).toBe(sport);
    }
  });

  it('uses the FIT epoch and CRC from the spec', () => {
    expect(FIT_EPOCH_OFFSET).toBe(Date.UTC(1989, 11, 31) / 1000);
    // CRC of the ASCII bytes "123456789" with FIT's CRC-16 (ARC) is 0xBB3D.
    expect(fitCrc(new TextEncoder().encode('123456789'))).toBe(0xbb3d);
  });
});

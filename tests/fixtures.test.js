// Shared JS ↔ Java processing fixtures (android/app/src/test/resources/fixtures).
//
// Each fixture is a journal plus the JS results. WorkoutBuilderTest.java checks the Java
// port against them; this file checks the JS still produces them. If processing changes
// on purpose, regenerate with:  GEN_FIXTURES=1 npx vitest run tests/fixtures.test.js

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, packTrack, toBase64 } from '../src/db/trackCodec.js';
import { generateCalibratedCity2Surf } from '../src/seed/city2surf.js';
import { buildWorkout } from '../src/services/buildWorkout.js';
import { generateJournal } from '../src/tracker/synthetic.js';

const DIR = path.resolve(__dirname, '../android/app/src/test/resources/fixtures');

/** A noisy run: auto-paused stretch, poor-accuracy fixes (gated) and a position spike. */
function messyRun() {
  const lines = generateJournal({ activity: 'run', seconds: 900, seed: 77, heartRate: true }).text.trim().split('\n').map((l) => JSON.parse(l));
  let k = 0;
  for (const l of lines) {
    if (l.type !== 'pt') continue;
    k++;
    if (k >= 300 && k < 340) l.p = 1; // auto-paused
    if (k % 97 === 0) l.ha = 60; // fails the accuracy gate
    if (k === 500) l.lat += 0.01; // ~1.1 km spike
    if (k >= 600 && k < 620) delete l.sp; // no Doppler speed: derived from positions
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

export const CASES = {
  'run-hr-pause': () => generateJournal({ activity: 'run', seconds: 1800, pauses: [[600, 90]], seed: 11, heartRate: true }).text,
  'walk-nobaro': () => generateJournal({ activity: 'walk', seconds: 1500, seed: 12, hasBarometer: false }).text,
  cycle: () => generateJournal({ activity: 'cycle', seconds: 1200, seed: 13 }).text,
  ski: () => generateJournal({ activity: 'ski', seconds: 2400, seed: 5 }).text,
  city2surf: () => generateCalibratedCity2Surf().text,
  'messy-run': messyRun,
};

const SAMPLE = (n) => [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1];

function expectedFor(text) {
  const { workout, track } = buildWorkout(text, 'fixture');
  const idx = SAMPLE(track.n);
  const pick = (arr) => (arr ? idx.map((i) => (Number.isFinite(arr[i]) ? arr[i] : null)) : null);
  const blob = packTrack(track);
  return {
    summary: workout.summary,
    activeIntervals: workout.activeIntervals,
    previewLength: workout.preview.length,
    previewFirst: workout.preview[0],
    previewLast: workout.preview.at(-1),
    n: track.n,
    samples: {
      index: idx,
      t: pick(track.t),
      lat: pick(track.lat),
      lon: pick(track.lon),
      alt: pick(track.alt),
      speed: pick(track.speed),
      dist: pick(track.dist),
      active: pick(track.active),
      course: pick(track.course),
      moving: pick(track.moving),
      hr: pick(track.hr),
    },
    trackBlob: toBase64(blob),
    trackCrc: crc32(blob),
  };
}

describe('JS ↔ Java processing fixtures', () => {
  for (const [name, gen] of Object.entries(CASES)) {
    it(`${name}: JS output matches the committed fixture`, () => {
      const text = gen();
      const exp = expectedFor(text);
      const journalPath = path.join(DIR, `${name}.ndjson`);
      const expectedPath = path.join(DIR, `${name}.expected.json`);
      if (process.env.GEN_FIXTURES) {
        fs.mkdirSync(DIR, { recursive: true });
        fs.writeFileSync(journalPath, text);
        fs.writeFileSync(expectedPath, JSON.stringify(exp, null, 1) + '\n');
      }
      expect(fs.readFileSync(journalPath, 'utf8')).toBe(text);
      const committed = JSON.parse(fs.readFileSync(expectedPath, 'utf8'));
      expect(committed.trackCrc).toBe(exp.trackCrc);
      expect(committed.summary).toEqual(JSON.parse(JSON.stringify(exp.summary)));
    });
  }
});

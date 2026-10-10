// Voice announcements. The scenarios are also written to a shared fixture that
// VoiceCoachTest.java replays against the native port, so both say exactly the same thing.
// After changing the phrasing on purpose, regenerate with:
//   GEN_FIXTURES=1 npx vitest run tests/voice.test.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VoiceCoach, spokenAverage, spokenDistance, spokenDuration, voiceConfig } from '../src/voice/coach.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../android/app/src/test/resources/fixtures/voice.json');

const cfg = (over) => ({ splits: false, time: false, goal: false, intervalMin: 10, goalM: 0, pace: true, imperial: false, ...over });

/** Deterministic progress samples: [distance m, active elapsed ms] every `stepS` seconds. */
function samples({ seconds, stepS, speed, wobble = 0.1, startM = 0, startMs = 0 }) {
  const out = [];
  let d = startM;
  for (let t = stepS; t <= seconds; t += stepS) {
    d += speed * stepS * (1 + wobble * Math.sin(t / 97));
    out.push([Math.round(d * 100) / 100, startMs + t * 1000]);
  }
  return out;
}

const SCENARIOS = [
  { name: 'run-all-metric', cfg: cfg({ splits: true, time: true, goal: true, intervalMin: 5, goalM: 10000 }), samples: samples({ seconds: 4000, stepS: 2, speed: 1000 / 378 }) },
  { name: 'cycle-imperial-speed', cfg: cfg({ splits: true, time: true, intervalMin: 15, pace: false, imperial: true }), samples: samples({ seconds: 3700, stepS: 3, speed: 7.2 }) },
  { name: 'walk-goal-only', cfg: cfg({ goal: true, goalM: 5000 }), samples: samples({ seconds: 3800, stepS: 3, speed: 1.4 }) },
  { name: 'ski-time-only', cfg: cfg({ time: true, intervalMin: 30, pace: false }), samples: samples({ seconds: 3700, stepS: 5, speed: 5, wobble: 0.6 }) },
  // Service restarted mid-run without saved coach state: nothing already passed is repeated.
  { name: 'run-resumed', cfg: cfg({ splits: true, goal: true, goalM: 5000 }), sync: [2600, 900000], samples: samples({ seconds: 900, stepS: 2, speed: 2.8, startM: 2600, startMs: 900000 }) },
];

function run(sc) {
  const coach = new VoiceCoach(sc.cfg);
  if (sc.sync) coach.syncTo(...sc.sync);
  const said = [];
  sc.samples.forEach(([d, ms], i) => {
    const text = coach.onProgress(d, ms);
    if (text) said.push({ i, text });
  });
  return said;
}

describe('voice phrases', () => {
  it('speaks durations naturally', () => {
    expect(spokenDuration(372000)).toBe('6 minutes 12 seconds');
    expect(spokenDuration(3600000)).toBe('1 hour');
    expect(spokenDuration(3785000)).toBe('1 hour 3 minutes 5 seconds');
    expect(spokenDuration(61000)).toBe('1 minute 1 second');
    expect(spokenDuration(0)).toBe('0 seconds');
  });

  it('speaks distances with sensible precision and plurals', () => {
    expect(spokenDistance(5000, false)).toBe('5 kilometres');
    expect(spokenDistance(1000, false)).toBe('1 kilometre');
    expect(spokenDistance(1500, false)).toBe('1.5 kilometres');
    expect(spokenDistance(999.9, false)).toBe('0.99 kilometres');
    expect(spokenDistance(5 * 1609.344, true)).toBe('5 miles');
  });

  it('speaks average pace or speed', () => {
    expect(spokenAverage(5000, 5 * 378000, { pace: true, imperial: false })).toBe('Average pace 6 minutes 18 seconds per kilometre.');
    expect(spokenAverage(24300, 3600000, { pace: false, imperial: false })).toBe('Average speed 24.3 kilometres per hour.');
    expect(spokenAverage(1609.344 * 15, 3600000, { pace: false, imperial: true })).toBe('Average speed 15 miles per hour.');
  });
});

describe('voice triggers', () => {
  it('announces each split with its split time and the average pace', () => {
    const c = new VoiceCoach(cfg({ splits: true }));
    expect(c.onProgress(999, 370000)).toBeNull();
    expect(c.onProgress(1001, 372000)).toBe('1 kilometre. Split time 6 minutes 12 seconds. Average pace 6 minutes 12 seconds per kilometre.');
    expect(c.onProgress(1500, 560000)).toBeNull();
    expect(c.onProgress(2003, 756000)).toBe('2 kilometres. Split time 6 minutes 24 seconds. Average pace 6 minutes 17 seconds per kilometre.');
  });

  it('announces on active time, every interval', () => {
    const c = new VoiceCoach(cfg({ time: true, intervalMin: 5 }));
    expect(c.onProgress(790, 299000)).toBeNull();
    expect(c.onProgress(800, 300000)).toBe('5 minutes. Distance 0.8 kilometres. Average pace 6 minutes 15 seconds per kilometre.');
    expect(c.onProgress(1600, 600000)).toBe('10 minutes. Distance 1.6 kilometres. Average pace 6 minutes 15 seconds per kilometre.');
  });

  it('announces 25, 50, 75 and 100 percent of the goal once each', () => {
    const c = new VoiceCoach(cfg({ goal: true, goalM: 10000 }));
    expect(c.onProgress(2500, 945000)).toBe('25 percent of your 10 kilometre goal. 2.5 kilometres. Average pace 6 minutes 18 seconds per kilometre.');
    expect(c.onProgress(2600, 980000)).toBeNull();
    expect(c.onProgress(5000, 1890000)).toMatch(/^Halfway to your 10 kilometre goal\. 5 kilometres\./);
    expect(c.onProgress(7500, 2835000)).toMatch(/^75 percent/);
    expect(c.onProgress(10000, 3780000)).toMatch(/^Goal reached: 10 kilometre goal, in 1 hour 3 minutes\./);
    expect(c.onProgress(11000, 4200000)).toBeNull();
  });

  it('merges announcements that fall together, speaking the average once', () => {
    const c = new VoiceCoach(cfg({ splits: true, goal: true, goalM: 10000 }));
    for (let d = 10; d < 5000; d += 10) c.onProgress(d, d * 378);
    expect(c.onProgress(5000, 1890000)).toBe(
      '5 kilometres. Split time 6 minutes 18 seconds. Halfway to your 10 kilometre goal. Average pace 6 minutes 18 seconds per kilometre.'
    );
  });

  it('reports the kind of each announcement for the watch buzz (the most important wins)', () => {
    const c = new VoiceCoach(cfg({ splits: true, time: true, intervalMin: 5, goal: true, goalM: 4000 }));
    c.onProgress(500, 180000);
    expect(c.lastKind).toBeNull();
    c.onProgress(1000, 299000);
    expect(c.lastKind).toBe('goal'); // 1 km split and 25% of the goal at once
    c.onProgress(1500, 300000);
    expect(c.lastKind).toBe('time');
    c.onProgress(2000, 420000);
    expect(c.lastKind).toBe('goal');
    c.onProgress(3000, 590000);
    expect(c.lastKind).toBe('goal');
    c.onProgress(3500, 595000);
    expect(c.lastKind).toBeNull();
    c.onProgress(4000, 599000);
    expect(c.lastKind).toBe('goal-reached');
    const s = new VoiceCoach(cfg({ splits: true }));
    s.onProgress(1000, 300000);
    expect(s.lastKind).toBe('split');
  });

  it('stays quiet when every kind is off, but keeps counting', () => {
    const c = new VoiceCoach(cfg({}));
    expect(c.enabled).toBe(false);
    expect(c.onProgress(3000, 1200000)).toBeNull();
    expect(c.splitsDone).toBe(3);
  });

  it('builds the config from settings', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    expect(voiceConfig(s, 'run')).toMatchObject({ splits: true, time: false, goal: false, goalM: 0, autoGoal: true, pace: true, imperial: false });
    expect(voiceConfig({ ...s, units: 'imperial' }, 'cycle')).toMatchObject({ splits: false, pace: false, imperial: true });
  });
});

describe('JS ↔ Java voice fixture', () => {
  const results = SCENARIOS.map((sc) => ({ ...sc, expected: run(sc) }));

  it('scenarios say something sensible', () => {
    const byName = Object.fromEntries(results.map((r) => [r.name, r.expected]));
    expect(byName['run-all-metric'].length).toBeGreaterThan(15);
    expect(byName['walk-goal-only'].map((e) => e.text.split('.')[0])).toEqual([
      '25 percent of your 5 kilometre goal',
      'Halfway to your 5 kilometre goal',
      '75 percent of your 5 kilometre goal',
      'Goal reached: 5 kilometre goal, in 59 minutes 30 seconds',
    ]);
    expect(byName['run-resumed'][0].text).toMatch(/^3 kilometres\./);
  });

  it('matches the committed fixture', () => {
    if (process.env.GEN_FIXTURES) fs.writeFileSync(FIXTURE, JSON.stringify(results, null, 0) + '\n');
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(results)));
  });
});

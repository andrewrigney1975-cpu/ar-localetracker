// Voice announcements. The scenarios are also written to a shared fixture that
// VoiceCoachTest.java replays against the native port, so both say exactly the same thing.
// After changing the phrasing on purpose, regenerate with:
//   GEN_FIXTURES=1 npx vitest run tests/voice.test.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VoiceCoach, routineVoice, spokenAverage, spokenDistance, spokenDuration, spokenTimeToGo, voiceConfig } from '../src/voice/coach.js';
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
  // Routine with the countdown: 1000, 500, 200 and 100 metres to go, then the goal.
  { name: 'walk-countdown', cfg: cfg({ goal: true, goalM: 4700, countdown: true, routine: true }), samples: samples({ seconds: 3600, stepS: 3, speed: 1.4 }) },
  // Routine of 10 km or more: thirds as well as quarters, each with the time to go.
  { name: 'run-routine-12k', cfg: cfg({ splits: true, goal: true, goalM: 12000, routine: true }), samples: samples({ seconds: 4800, stepS: 2, speed: 2.7 }) },
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

  it('speaks the time to go to the minute', () => {
    expect(spokenTimeToGo(3785000)).toBe('1 hour and 3 minutes to go.');
    expect(spokenTimeToGo(31 * 60000 - 20000)).toBe('31 minutes to go.');
    expect(spokenTimeToGo(7200000)).toBe('2 hours to go.');
    expect(spokenTimeToGo(5000)).toBe('1 minute to go.');
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

  it('says the distance so far with the time, even when a split falls on the same fix', () => {
    const c = new VoiceCoach(cfg({ splits: true, time: true, intervalMin: 5 }));
    c.onProgress(500, 150000);
    expect(c.onProgress(1030, 300000)).toBe(
      '1 kilometre. Split time 5 minutes. 5 minutes. Distance 1.03 kilometres. Average pace 4 minutes 51 seconds per kilometre.'
    );
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

  it('says the time to go instead of the average at a routine milestone', () => {
    const c = new VoiceCoach(cfg({ goal: true }));
    c.setGoal(8000, 0, true);
    expect(c.onProgress(2000, 756000)).toBe('25 percent of your 8 kilometre goal. 2 kilometres. 38 minutes to go.');
    expect(c.onProgress(4000, 1512000)).toBe('Halfway to your 8 kilometre goal. 4 kilometres. 25 minutes to go.');
    expect(c.onProgress(8000, 3024000)).toBe('Goal reached: 8 kilometre goal, in 50 minutes 24 seconds. Average pace 6 minutes 18 seconds per kilometre.');
    const plain = new VoiceCoach(cfg({ goal: true }));
    plain.setGoal(8000, 0);
    expect(plain.onProgress(2000, 756000)).toMatch(/Average pace/);
  });

  it('adds 33 and 66 percent for routines of 10 kilometres or more', () => {
    const c = new VoiceCoach(cfg({ goal: true, imperial: false }));
    c.setGoal(21000, 0, true);
    const heads = [5250, 7000, 10500, 14000, 15750, 21000].map((d) => c.onProgress(d, d * 360).split('.')[0]);
    expect(heads).toEqual([
      '25 percent of your 21 kilometre goal',
      '33 percent of your 21 kilometre goal',
      'Halfway to your 21 kilometre goal',
      '66 percent of your 21 kilometre goal',
      '75 percent of your 21 kilometre goal',
      'Goal reached: 21 kilometre goal, in 2 hours 6 minutes',
    ]);
    expect(c.onProgress(7000, 7000 * 360 + 1000)).toBeNull();
    // Not for a shorter routine, nor a 10 km goal that isn't a routine.
    const short = new VoiceCoach(cfg({ goal: true }));
    short.setGoal(9000, 0, true);
    short.onProgress(2250, 810000);
    expect(short.onProgress(3000, 1080000)).toBeNull();
    const manual = new VoiceCoach(cfg({ goal: true }));
    manual.setGoal(12000, 0);
    manual.onProgress(3000, 1080000);
    expect(manual.onProgress(4000, 1440000)).toBeNull();
    // A goal set mid-way (or a resume) doesn't repeat the thirds already passed.
    const mid = new VoiceCoach(cfg({ goal: true }));
    mid.setGoal(12000, 4100, true);
    expect(mid.onProgress(4200, 1500000)).toBeNull();
    const r = new VoiceCoach(cfg({ goal: true, goalM: 12000, routine: true }));
    r.syncTo(8100, 2900000);
    expect(r.onProgress(8200, 2950000)).toBeNull();
    expect(r.onProgress(9000, 3240000)).toMatch(/^75 percent/);
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

  it('counts down the last kilometre, short and once each', () => {
    const c = new VoiceCoach(cfg({ goal: true, goalM: 4700, countdown: true }));
    c.onProgress(3600, 2630000); // past 75%
    expect(c.onProgress(3690, 2700000)).toBeNull();
    expect(c.onProgress(3700, 2710000)).toBe('1000 metres to go.');
    expect(c.lastKind).toBe('countdown');
    expect(c.onProgress(3710, 2720000)).toBeNull();
    expect(c.onProgress(4200, 3080000)).toBe('500 metres to go.');
    expect(c.onProgress(4500, 3300000)).toBe('200 metres to go.');
    expect(c.onProgress(4600, 3370000)).toBe('100 metres to go.');
    expect(c.onProgress(4700, 3440000)).toMatch(/^Goal reached: 4\.7 kilometre goal/);
  });

  it('merges the countdown with a milestone or split on the same fix', () => {
    const c = new VoiceCoach(cfg({ splits: true, goal: true, goalM: 4000, countdown: true }));
    for (let d = 10; d < 3000; d += 10) c.onProgress(d, d * 378);
    expect(c.onProgress(3000, 1134000)).toBe(
      '3 kilometres. Split time 6 minutes 18 seconds. 75 percent of your 4 kilometre goal. 1000 metres to go. Average pace 6 minutes 18 seconds per kilometre.'
    );
    expect(c.lastKind).toBe('goal');
  });

  it('says only the nearest when a jump passes several, and nothing past the goal', () => {
    const c = new VoiceCoach(cfg({ goal: true, goalM: 5000, countdown: true }));
    c.onProgress(3900, 1400000);
    expect(c.onProgress(4850, 1800000)).toBe('200 metres to go.');
    const g = new VoiceCoach(cfg({ goal: true, goalM: 5000, countdown: true }));
    g.onProgress(4850, 1800000);
    expect(g.onProgress(5010, 1860000)).toMatch(/^Goal reached/);
  });

  it('skips steps longer than the goal, and keeps quiet off route or with goals off', () => {
    const short = new VoiceCoach(cfg({ goal: true, goalM: 800, countdown: true }));
    short.setGoal(800, 0);
    expect(short.onProgress(300, 120000)).toMatch(/0\.3 kilometres\. 500 metres to go\./);
    const off = new VoiceCoach(cfg({ goal: true, goalM: 5000, countdown: true }));
    off.pauseGoal();
    expect(off.onProgress(4000, 1500000)).toBeNull();
    const silent = new VoiceCoach(cfg({ goal: false, goalM: 5000, countdown: true }));
    expect(silent.onProgress(4000, 1500000)).toBeNull();
    const none = new VoiceCoach(cfg({ goal: true, goalM: 5000 }));
    expect(none.onProgress(4000, 1500000)).not.toMatch(/to go/);
  });

  it('does not repeat the countdown after a goal set mid-way or a resume', () => {
    const c = new VoiceCoach(cfg({ goal: true, goalM: 0, countdown: true }));
    c.setGoal(5000, 4600);
    expect(c.countdownDone).toBe(2);
    expect(c.onProgress(4910, 1800000)).toMatch(/^100 metres to go\./);
    const r = new VoiceCoach(cfg({ goal: true, goalM: 5000, countdown: true }));
    r.syncTo(4300, 1600000);
    expect(r.onProgress(4310, 1604000)).toBeNull();
    expect(r.onProgress(4500, 1680000)).toBe('500 metres to go.');
  });

  it('stays quiet when every kind is off, but keeps counting', () => {
    const c = new VoiceCoach(cfg({}));
    expect(c.enabled).toBe(false);
    expect(c.onProgress(3000, 1200000)).toBeNull();
    expect(c.splitsDone).toBe(3);
  });

  it('keeps each kind independent: time off leaves splits and the goal speaking', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.voice.time.walk = false;
    s.voice.splits.walk = true;
    const c = new VoiceCoach(voiceConfig(s, 'walk'));
    expect(c.enabled).toBe(true);
    c.setGoal(4000, 0);
    expect(c.onProgress(1001, 600000)).toMatch(/^1 kilometre\. Split time 10 minutes\. 25 percent of your 4 kilometre goal\./);
    expect(c.onProgress(1500, 1200000)).toBeNull(); // 20 minutes: no time announcement
  });

  it("switches to a recognised routine's own settings", () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    s.voice.routines = { r1: { splits: false, time: true, goal: false, intervalMin: 5 } };
    expect(routineVoice(s, 'r2')).toBeNull();
    expect(routineVoice(s, null)).toBeNull();
    const c = new VoiceCoach(voiceConfig(s, 'walk'));
    c.setGoal(4000, 0);
    c.applyRoutine(routineVoice(s, 'r1'), 420000); // recognised at 7 minutes: the 5-minute mark has passed
    expect(c.intervalsDone).toBe(1);
    expect(c.onProgress(1001, 540000)).toBeNull(); // no split, no goal milestone
    expect(c.onProgress(1100, 600000)).toMatch(/^10 minutes\. Distance 1\.1 kilometres\./);
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
    expect(byName['run-routine-12k'].filter((e) => /percent|Halfway/.test(e.text)).map((e) => e.text.replace(/^\d+ kilometres\. Split time [^.]+\. /, ''))).toMatchInlineSnapshot(`
      [
        "25 percent of your 12 kilometre goal. 55 minutes to go.",
        "33 percent of your 12 kilometre goal. 49 minutes to go.",
        "Halfway to your 12 kilometre goal. 37 minutes to go.",
        "66 percent of your 12 kilometre goal. 25 minutes to go.",
        "75 percent of your 12 kilometre goal. 18 minutes to go.",
      ]
    `);
    expect(byName['walk-countdown'].map((e) => e.text.split('.')[0])).toEqual([
      '25 percent of your 4',
      'Halfway to your 4',
      '75 percent of your 4',
      '1000 metres to go',
      '500 metres to go',
      '200 metres to go',
      '100 metres to go',
      'Goal reached: 4',
    ]);
  });

  it('matches the committed fixture', () => {
    if (process.env.GEN_FIXTURES) fs.writeFileSync(FIXTURE, JSON.stringify(results, null, 0) + '\n');
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify(results)));
  });
});

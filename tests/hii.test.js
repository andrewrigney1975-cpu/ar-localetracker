// High-intensity interval plans. The cases are also written to a shared fixture that
// HiiPlanTest.java replays against the native port, so both make exactly the same plan.
// After changing the generator on purpose, regenerate with:
//   GEN_FIXTURES=1 npx vitest run tests/hii.test.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HII_DEFAULTS, HII_MODES, hiiAt, makePlan, planIntervals, planTotals, validateHii } from '../src/hii/plan.js';
import { VoiceCoach, hiiEvents } from '../src/voice/coach.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../android/app/src/test/resources/fixtures/hii.json');

const D = HII_DEFAULTS;
const CASES = [
  { durationS: 1800, shares: D.shares, bouts: D.bouts, seed: 1 },
  { durationS: 1800, shares: D.shares, bouts: D.bouts, seed: 2 },
  { durationS: 3600, shares: D.shares, bouts: D.bouts, seed: 123456789 },
  { durationS: 1203, shares: { walk: 25, jog: 25, run: 25, sprint: 25 }, bouts: D.bouts, seed: 42 },
  { durationS: 2400, shares: { walk: 50, jog: 0, run: 30, sprint: 20 }, bouts: { walk: [30, 90], jog: [60, 120], run: [60, 90], sprint: [20, 30] }, seed: 7 },
  // Very little walking: fewer, longer hard bouts, then walks shorter than the minimum.
  { durationS: 1200, shares: { walk: 10, jog: 30, run: 40, sprint: 20 }, bouts: D.bouts, seed: 99 },
  { durationS: 600, shares: { walk: 100, jog: 0, run: 0, sprint: 0 }, bouts: D.bouts, seed: 5 },
  { durationS: 900, shares: { walk: 40, jog: 40, run: 20, sprint: 0 }, bouts: { walk: [5, 600], jog: [5, 600], run: [5, 600], sprint: [5, 600] }, seed: 2147483647 },
];

const totals = (items) => Object.fromEntries(HII_MODES.map((m) => [m, items.filter((i) => i[0] === m).reduce((a, i) => a + i[2], 0)]));

describe('interval plan', () => {
  it('gives each mode its share of the time, to the second', () => {
    for (const c of CASES) {
      const p = planIntervals(c);
      const n = Math.floor(c.durationS / 5) * 5;
      expect(p.durationS).toBe(n);
      const t = totals(p.items);
      expect(Object.values(t).reduce((a, b) => a + b, 0)).toBe(n);
      for (const m of HII_MODES) expect(Math.abs(t[m] - (n * c.shares[m]) / 100)).toBeLessThan(5 * 4);
    }
    // 30 minutes at 40/30/20/10 divides exactly.
    expect(totals(planIntervals(CASES[0]).items)).toEqual({ walk: 720, jog: 540, run: 360, sprint: 180 });
  });

  it('follows every run and sprint with a walk, so a sprint never follows a run', () => {
    for (const c of CASES.filter((x) => x.shares.walk >= 20)) {
      const items = planIntervals(c).items;
      items.forEach(([m], i) => {
        if (m === 'run' || m === 'sprint') expect(items[i + 1]?.[0]).toBe('walk');
        if (m === 'sprint' && i > 0) expect(items[i - 1][0]).not.toBe('run');
      });
    }
  });

  it('keeps bouts within their limits when the totals allow, contiguous and in order', () => {
    const p = planIntervals(CASES[2]);
    let at = 0;
    for (const [m, s, d] of p.items) {
      expect(s).toBe(at);
      at += d;
      const [lo, hi] = D.bouts[m];
      // Back-to-back bouts of one mode are joined, so only the minimum is firm.
      expect(d).toBeGreaterThanOrEqual(lo);
      if (m !== 'walk' && m !== 'jog') expect(d).toBeLessThanOrEqual(hi);
    }
    expect(at).toBe(3600);
    expect(['run', 'sprint']).not.toContain(p.items[0][0]);
  });

  it('is the same for the same seed and differs between seeds', () => {
    expect(planIntervals(CASES[0])).toEqual(planIntervals(CASES[0]));
    expect(planIntervals(CASES[0]).items).not.toEqual(planIntervals(CASES[1]).items);
  });

  it('says where the plan is, and the planned time per mode up to a stop', () => {
    const plan = makePlan({ ...CASES[0], atS: 60 });
    const [m0, , d0] = plan.items[0];
    expect(hiiAt(plan, 30)).toMatchObject({ index: -1, mode: null });
    expect(hiiAt(plan, 70)).toMatchObject({ index: 0, mode: m0, leftS: d0 - 10, next: plan.items[1][0] });
    expect(hiiAt(plan, 60 + 1800)).toMatchObject({ done: true });
    expect(planTotals(plan)).toEqual({ walk: 720, jog: 540, run: 360, sprint: 180 });
    const stopped = planTotals({ ...plan, stopS: 60 + d0 });
    expect(Object.values(stopped).reduce((a, b) => a + b, 0)).toBe(d0);
    expect(hiiAt({ ...plan, stopS: 60 + d0 }, 60 + d0)).toMatchObject({ done: true });
  });

  it('checks the settings', () => {
    expect(validateHii(D)).toBeNull();
    expect(validateHii({ ...D, shares: { ...D.shares, walk: 30 } })).toBe('The shares add up to 90%, not 100%');
    expect(validateHii({ ...D, shares: { walk: 0, jog: 50, run: 50, sprint: 0 } })).toMatch(/walking needs a share/);
    expect(validateHii({ ...D, bouts: { ...D.bouts, run: [120, 60] } })).toMatch(/^Run:/);
  });
});

describe('interval announcements', () => {
  const plan = makePlan({ ...CASES[0], atS: 0 });

  it('says the start, a warning 10 seconds before each change, and the end', () => {
    const ev = hiiEvents(plan);
    expect(ev).toHaveLength(plan.items.length + 1);
    const [m0, , d0] = plan.items[0];
    expect(ev[0]).toEqual({ ms: 0, text: `Intervals for 30 minutes. ${m0[0].toUpperCase() + m0.slice(1)} for ${d0 % 60 ? '' : ''}${ev[0].text.split(' for ').pop()}` });
    const [m1, s1, d1] = plan.items[1];
    expect(ev[1].ms).toBe((s1 - 10) * 1000);
    expect(ev[1].text).toMatch(new RegExp(`^Get ready to ${m1} in 10 seconds, for \\d`));
    expect(ev.at(-1)).toEqual({ ms: 1800000, text: 'Intervals complete.' });
    expect(hiiEvents({ ...plan, stopS: s1 })).toHaveLength(2);
  });

  it('speaks them on active time, alone without an average, and buzzes as an interval', () => {
    const c = new VoiceCoach({ splits: true, time: false, goal: false, intervalMin: 10, goalM: 0, pace: true, imperial: false });
    c.setPlan(plan, 0);
    expect(c.enabled).toBe(true);
    expect(c.onProgress(0, 0)).toMatch(/^Intervals for 30 minutes\./);
    expect(c.lastKind).toBe('interval');
    const s1 = plan.items[1][1];
    expect(c.onProgress(500, (s1 - 11) * 1000)).toBeNull();
    expect(c.onProgress(520, (s1 - 10) * 1000)).toMatch(/^Get ready to /);
    expect(c.onProgress(1000, (s1 + 60) * 1000)).toMatch(/1 kilometre\. Split time .* Average pace/); // merged with any warning due then
    // A plan joined part-way says nothing already passed.
    const late = new VoiceCoach({ splits: false, time: false, goal: false, intervalMin: 10, goalM: 0, pace: true, imperial: false });
    late.setPlan(plan, (s1 + 1) * 1000);
    expect(late.hiiDone).toBe(2);
  });

  it('matches the shared fixture', () => {
    const results = CASES.map((c) => ({ input: c, expected: planIntervals(c) }));
    if (process.env.GEN_FIXTURES) fs.writeFileSync(FIXTURE, JSON.stringify(results) + '\n');
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(results);
  });
});

describe('intervals as run', () => {
  it('finds time, distance and speed per mode from the journal, up to the stop', async () => {
    const { buildWorkout } = await import('../src/services/buildWorkout.js');
    const { boutsRun, intervalTotals, activeToWall } = await import('../src/stats/hii.js');
    const text = fs.readFileSync(path.resolve(path.dirname(FIXTURE), 'hii.ndjson'), 'utf8');
    const { workout, track } = buildWorkout(text, 'x');
    expect(workout.activity).toBe('hii');
    expect(workout.hii).toHaveLength(1);
    expect(workout.hii[0].stopS).toBe(900);
    const bouts = boutsRun(workout.hii, track, workout.activeIntervals);
    expect(bouts.at(-1).toS).toBe(900);
    const totals = intervalTotals(bouts);
    expect(totals.reduce((s, t) => s + t.seconds, 0)).toBe(900);
    const speed = Object.fromEntries(totals.map((t) => [t.mode, t.speed]));
    // The simulated route follows the plan: 1.5, 2.5, 3.4 and 5.2 m/s (a little under, from smoothing).
    expect(speed.walk).toBeLessThan(speed.jog);
    expect(speed.jog).toBeLessThan(speed.run);
    expect(speed.run).toBeLessThan(speed.sprint);
    expect(speed.sprint).toBeGreaterThan(4);
    expect(activeToWall([[1000, 2000], [5000, 9000]], 2)).toBe(6000);
    expect(activeToWall([[1000, 2000]], 5)).toBe(2000);
  });
});

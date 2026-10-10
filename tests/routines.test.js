// Goal prediction from learned routines (docs/plans/goal-prediction.md). The prediction
// cases are also written to a fixture that RoutineMatcherTest.java replays.
// Regenerate after an intended change:  GEN_FIXTURES=1 npx vitest run tests/routines.test.js

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { destination } from '../src/geo/geo.js';
import {
  buildRoutineModel,
  distanceToPolyline,
  goalFor,
  localTime,
  predictGoal,
  resample,
  routeDistance,
  sameRoute,
  features,
} from '../src/insights/routines.js';
import { RouteGuard } from '../src/insights/routeGuard.js';
import { predictionRecord } from '../src/services/buildWorkout.js';
import { parseJournal } from '../src/tracker/journal.js';
import { VoiceCoach, goalConfirmation, voiceConfig } from '../src/voice/coach.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';
import { replay, SCENARIOS } from '../scripts/evaluate-goals.mjs';
import { HOME, PARK, TYPICAL, loopRoute, makeHistory, outAndBack, rng } from './helpers/history.js';

const FIXTURE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../android/app/src/test/resources/fixtures/routines.json');
const TZ = -600; // Sydney (AEST)
const DAY = 86400000;
/** Epoch ms for a local Sydney time on a given UTC date. */
const at = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi) + TZ * 60000;

const record = (id, preview, distance, startedAt, extra = {}) => ({
  id,
  activity: 'run',
  startedAt,
  tzOffset: TZ,
  summary: { distance, duration: distance / 2.8 },
  preview,
  ...extra,
});

describe('route geometry', () => {
  const rand = rng(4);
  const loop = loopRoute(HOME, 5000, 30, rand);

  it('resamples a route to 32 points from start to finish', () => {
    const sig = resample(loop);
    expect(sig).toHaveLength(32);
    expect(sig[0][0]).toBeCloseTo(loop[0][1], 6);
    expect(sig[0][1]).toBeCloseTo(loop[0][0], 6);
  });

  it('treats the same loop, run either way round, as the same route', () => {
    const a = resample(loop);
    const again = resample(loopRoute(HOME, 5000, 30, rand));
    expect(routeDistance(a, again)).toBeLessThan(25);
    expect(routeDistance(a, [...again].reverse())).toBeLessThan(25);
  });

  it('tells different routes from the same start apart', () => {
    const a = resample(loop);
    const b = resample(loopRoute(HOME, 5000, 210, rand));
    expect(routeDistance(a, b)).toBeGreaterThan(500);
    const fa = features(record('a', loop, 5000, 0));
    const fb = features(record('b', loopRoute(HOME, 5000, 210, rand), 5000, 0));
    expect(sameRoute(fa, fb)).toBe(Infinity);
  });

  it('needs the same start and a similar distance', () => {
    const fa = features(record('a', loop, 5000, 0));
    const longer = features(record('b', loopRoute(HOME, 6000, 30, rand), 6000, 0));
    expect(sameRoute(fa, longer)).toBe(Infinity); // 17% longer
    const [lat, lon] = destination(HOME.lat, HOME.lon, 90, 600);
    const elsewhere = features(record('c', loopRoute({ lat, lon }, 5000, 30, rand), 5000, 0));
    expect(sameRoute(fa, elsewhere)).toBe(Infinity);
  });

  it('measures distance from a point to a route', () => {
    const line = resample(outAndBack(HOME, 4000, 90, rng(2), 0));
    const [lat, lon] = destination(HOME.lat, HOME.lon, 0, 300);
    expect(distanceToPolyline(lat, lon, line)).toBeGreaterThan(280);
    expect(distanceToPolyline(lat, lon, line)).toBeLessThan(320);
  });

  it('works out the local weekday and minute', () => {
    expect(localTime(at(2026, 9, 10, 7, 5), TZ)).toEqual({ weekday: 6, minute: 425 }); // Saturday 10 Oct 2026
  });
});

describe('off-route guard', () => {
  it('fires once after more than 2 minutes over 250 m from the route', () => {
    const g = new RouteGuard(resample(outAndBack(HOME, 4000, 90, rng(2), 0)));
    const [onLat, onLon] = destination(HOME.lat, HOME.lon, 90, 1000);
    const [offLat, offLon] = destination(HOME.lat, HOME.lon, 0, 400);
    expect(g.onFix(onLat, onLon, 0)).toBe(false);
    expect(g.onFix(offLat, offLon, 10000)).toBe(false);
    expect(g.onFix(onLat, onLon, 60000)).toBe(false); // back on route: timer resets
    expect(g.onFix(offLat, offLon, 70000)).toBe(false);
    expect(g.onFix(offLat, offLon, 189000)).toBe(false);
    expect(g.onFix(offLat, offLon, 190000)).toBe(true);
    expect(g.onFix(offLat, offLon, 400000)).toBe(false);
  });
});

describe('goal rounding', () => {
  it('snaps to a round number when the history clusters around one', () => {
    expect(goalFor([4900, 4980, 5020, 5100, 5050], false)).toBe(5000);
  });
  it('otherwise uses tenths, so percentages of a 4.7 km loop land in the right place', () => {
    expect(goalFor([4650, 4700, 4720, 4690], false)).toBe(4700);
    expect(goalFor([8000, 8050, 7950], true)).toBeCloseTo(5 * 1609.344, 1); // 4.97 mi → 5 mi
    expect(goalFor([6400, 6450, 6420], false)).toBe(6400);
  });
});

describe('learning routines', () => {
  const history = makeHistory({ seed: 7, weeks: 16, ...TYPICAL });
  const now = history[history.length - 1].startedAt + 3600000;
  const model = buildRoutineModel(history, { now });

  it('finds the planted routines', () => {
    const eligible = (act) => model.activities[act].routines.filter((r) => r.eligible);
    const walk = eligible('walk');
    expect(walk).toHaveLength(1);
    expect(walk[0].goal.metric).toBe(4700);
    expect(walk[0].name).toBe('Saturday morning loop');
    const runs = eligible('run').map((r) => r.goal.metric).sort((a, b) => a - b);
    expect(runs).toEqual([8000, 10000]);
    expect(eligible('run').find((r) => r.goal.metric === 8000).name).toBe('weekday evening route');
  });

  it('predicts from the start place, weekday and time', () => {
    const p = predictGoal(model, { activity: 'walk', now: at(2026, 9, 10, 7, 10), tzOffset: TZ, lat: HOME.lat, lon: HOME.lon });
    expect(p).toMatchObject({ goalM: 4700, source: 'route', name: 'Saturday morning loop' });
    const tue = predictGoal(model, { activity: 'run', now: at(2026, 9, 13, 18, 0), tzOffset: TZ, lat: HOME.lat, lon: HOME.lon });
    expect(tue.goalM).toBe(8000);
    const sun = predictGoal(model, { activity: 'run', now: at(2026, 9, 11, 8, 40), tzOffset: TZ, lat: PARK.lat, lon: PARK.lon });
    expect(sun.goalM).toBe(10000);
  });

  it('stays silent at the wrong time or an unknown place', () => {
    const night = predictGoal(model, { activity: 'walk', now: at(2026, 9, 10, 22, 30), tzOffset: TZ, lat: HOME.lat, lon: HOME.lon });
    expect(night.goalM).toBeNull();
    const [lat, lon] = destination(HOME.lat, HOME.lon, 0, 5000);
    expect(predictGoal(model, { activity: 'run', now: at(2026, 9, 13, 18, 0), tzOffset: TZ, lat, lon }).goalM).toBeNull();
  });

  it('falls back to the time of day when there is no GPS fix yet', () => {
    const p = predictGoal(model, { activity: 'walk', now: at(2026, 9, 10, 7, 10), tzOffset: TZ });
    expect(p).toMatchObject({ source: 'time', goalM: 4700, name: 'weekend morning walks' });
  });

  it('gives goals in the user’s units', () => {
    const p = predictGoal(model, { activity: 'run', now: at(2026, 9, 11, 8, 40), tzOffset: TZ, lat: PARK.lat, lon: PARK.lon, imperial: true });
    expect(p.goalM).toBeCloseTo(6.2 * 1609.344, 1);
  });

  it('needs enough history first', () => {
    const few = buildRoutineModel(history.filter((w) => w.activity === 'walk').slice(0, 4), { now });
    expect(predictGoal(few, { activity: 'walk', now, tzOffset: TZ, lat: HOME.lat, lon: HOME.lon })).toEqual({ goalM: null, reason: 'learning', have: 4, need: 5 });
    expect(predictGoal(model, { activity: 'ski', now, tzOffset: TZ })).toMatchObject({ goalM: null, reason: 'learning', have: 0 });
  });

  it('ignores the sample workout, short false starts and forgotten workouts', () => {
    const walks = history.filter((w) => w.activity === 'walk');
    const extra = [
      { ...walks[0], id: 'sample-city2surf-2026' },
      { ...walks[1], id: 'short', summary: { distance: 300, duration: 120 } },
    ];
    const m = buildRoutineModel([...walks, ...extra], { now });
    expect(m.activities.walk.usable).toBe(walks.filter((w) => now - w.startedAt <= 180 * DAY).length);
    const forgotten = buildRoutineModel(walks, { now, excluded: walks.map((w) => w.id) });
    expect(forgotten.activities.walk).toBeUndefined();
  });

  it('uses names the user gave a routine', () => {
    const id = model.activities.walk.routines.find((r) => r.eligible).id;
    const named = buildRoutineModel(history, { now, names: { [id]: 'lake loop' } });
    expect(predictGoal(named, { activity: 'walk', now: at(2026, 9, 10, 7, 10), tzOffset: TZ, lat: HOME.lat, lon: HOME.lon }).name).toBe('lake loop');
  });

  it('stops predicting a routine whose recent goals mostly missed', () => {
    const walks = history.filter((w) => w.activity === 'walk');
    const id = model.activities.walk.routines.find((r) => r.eligible).id;
    const missed = walks.map((w, i) => (i >= walks.length - 3 ? { ...w, prediction: { goalM: 9000, source: 'route', routineId: id } } : w));
    const m = buildRoutineModel(missed, { now });
    const r = m.activities.walk.routines.find((x) => x.id === id);
    expect(r).toMatchObject({ suppressed: true, eligible: false, predictions: 3, hits: 0 });
  });

  it('does not guess between two routes run from the same place at the same time', () => {
    const coin = SCENARIOS['two routes, same start and time'](3);
    const m = buildRoutineModel(coin, { now: coin[coin.length - 1].startedAt + 1000 });
    const last = coin[coin.length - 1];
    const p = predictGoal(m, { activity: 'run', now: last.startedAt + 7 * DAY, tzOffset: TZ, lat: HOME.lat, lon: HOME.lon });
    expect(p.goalM).toBeNull();
  });
});

describe('replay evaluation', () => {
  it('meets the shipping bar: ≥ 85% of auto goals within 10%, none on noise', () => {
    const typical = replay(makeHistory({ seed: 11, weeks: 14, ...TYPICAL }));
    expect(typical.goals).toBeGreaterThan(typical.workouts * 0.5);
    expect(typical.precision).toBeGreaterThanOrEqual(0.85);
    // Random workouts from home can occasionally look like a routine by chance; keep it rare.
    const noise = replay(makeHistory({ seed: 12, weeks: 14, routines: [], oneOffsPerWeek: 4, oneOffFrom: HOME }));
    expect(noise.goals / noise.workouts).toBeLessThanOrEqual(0.02);
  });
});

describe('goal in the voice coach and the saved workout', () => {
  it('sets a goal mid-workout without announcing milestones already passed', () => {
    const c = new VoiceCoach({ splits: false, time: false, goal: false, goalM: 0, intervalMin: 10, pace: true, imperial: false, autoGoal: true });
    expect(c.enabled).toBe(true);
    c.setGoal(4000, 1200); // decided late, past 25%
    expect(c.onProgress(1500, 540000)).toBeNull();
    expect(c.onProgress(2000, 720000)).toMatch(/^Halfway to your 4 kilometre goal/);
    c.pauseGoal();
    expect(c.onProgress(3000, 1080000)).toBeNull();
  });

  it('confirms the goal in words', () => {
    expect(goalConfirmation(4700, false, 'route', 'Saturday morning loop')).toBe('Goal 4.7 kilometres, your usual Saturday morning loop.');
    expect(goalConfirmation(5000, false, 'time', 'weekend morning walks')).toBe('Goal 5 kilometres, based on your weekend morning walks.');
    expect(goalConfirmation(1609.344, true, 'manual')).toBe('Goal 1 mile.');
  });

  it('defaults to Auto goals (Off for ski) and keeps manual goals separate', () => {
    const s = structuredClone(DEFAULT_SETTINGS);
    expect(voiceConfig(s, 'run')).toMatchObject({ autoGoal: true, goal: false, goalM: 0, confirmGoal: true });
    expect(voiceConfig(s, 'ski')).toMatchObject({ autoGoal: false, goal: false });
    s.voice.goalMode.run = 'set';
    expect(voiceConfig(s, 'run')).toMatchObject({ autoGoal: false, goal: true, goalM: 10000 });
  });

  it('records the goal from the journal on the workout', () => {
    const j = parseJournal(
      [
        '{"type":"meta","v":1,"workoutId":"x","activity":"run","startedAt":1}',
        '{"type":"goal","t":2,"goalM":4700,"source":"route","routineId":"w0001","name":"Saturday morning loop","confidence":0.91}',
        '{"type":"goal","t":3,"goalM":4700,"source":"route","routineId":"w0001","name":"Saturday morning loop","confidence":0.91,"offRoute":true}',
      ].join('\n')
    );
    expect(predictionRecord(j.goal)).toEqual({ goalM: 4700, source: 'route', routineId: 'w0001', name: 'Saturday morning loop', confidence: 0.91, offRoute: true });
    expect(predictionRecord(null)).toBeNull();
  });
});

describe('JS ↔ Java routine fixture', () => {
  const history = makeHistory({ seed: 21, weeks: 12, ...TYPICAL });
  const now = history[history.length - 1].startedAt + 3600000;
  const model = buildRoutineModel(history, { now });
  const [farLat, farLon] = destination(HOME.lat, HOME.lon, 45, 4000);
  const near = destination(HOME.lat, HOME.lon, 120, 150);
  const ctx = (activity, t, place, imperial = false) => ({ activity, now: t, tzOffset: TZ, lat: place?.[0] ?? null, lon: place?.[1] ?? null, imperial });
  const home = [HOME.lat, HOME.lon];
  const park = [PARK.lat, PARK.lon];
  const cases = [
    ctx('walk', at(2026, 9, 10, 7, 0), home),
    ctx('walk', at(2026, 9, 10, 7, 0), near),
    ctx('walk', at(2026, 9, 10, 7, 0), home, true),
    ctx('walk', at(2026, 9, 10, 13, 0), home),
    ctx('walk', at(2026, 9, 14, 7, 0), home),
    ctx('walk', at(2026, 9, 10, 7, 0), null),
    ctx('run', at(2026, 9, 13, 18, 20), home),
    ctx('run', at(2026, 9, 15, 18, 0), home, true),
    ctx('run', at(2026, 9, 11, 8, 30), park),
    ctx('run', at(2026, 9, 11, 8, 30), home),
    ctx('run', at(2026, 9, 13, 18, 20), [farLat, farLon]),
    ctx('run', at(2026, 9, 13, 18, 20), null),
    ctx('cycle', at(2026, 9, 11, 6, 30), home),
    ctx('ski', at(2026, 9, 11, 9, 0), home),
    // Daylight saving (AEDT, UTC+11): same local time, different offset.
    { ...ctx('walk', at(2026, 9, 10, 7, 0) - 3600000, home), tzOffset: -660 },
  ];
  const results = cases.map((c) => ({ ctx: c, expected: predictGoal(model, c) }));

  it('covers route, time-only, learning and unsure outcomes', () => {
    const kinds = new Set(results.map((r) => r.expected.source ?? r.expected.reason));
    expect([...kinds].sort()).toEqual(['learning', 'route', 'time', 'unsure']);
  });

  it('matches the committed fixture', () => {
    if (process.env.GEN_FIXTURES) fs.writeFileSync(FIXTURE, JSON.stringify({ model, cases: results }) + '\n');
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    expect(committed).toEqual(JSON.parse(JSON.stringify({ model, cases: results })));
  });
});

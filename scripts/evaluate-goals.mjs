// Replay evaluation for goal prediction (docs/plans/goal-prediction.md §7).
// Walks each history in date order, predicts every workout from the earlier ones only, and
// reports coverage (how often a goal is set), precision (actual within ±10% of the goal)
// and false goals.
//
//   node scripts/evaluate-goals.mjs                 synthetic histories
//   node scripts/evaluate-goals.mjs workouts.json   also a real export: an array of workout
//                                                   records, or {workouts: [...]}

import fs from 'node:fs';
import { buildRoutineModel, predictGoal } from '../src/insights/routines.js';
import { HOME, PARK, TYPICAL, makeHistory } from '../tests/helpers/history.js';

export function replay(workouts) {
  const sorted = workouts.map((w) => ({ ...w, prediction: undefined })).sort((a, b) => a.startedAt - b.startedAt);
  let goals = 0;
  let hits = 0;
  const bySource = { route: [0, 0], time: [0, 0] };
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i];
    if (String(w.id).startsWith('sample-') || !w.preview?.length) continue;
    const model = buildRoutineModel(sorted.slice(0, i), { now: w.startedAt });
    const [lon, lat] = w.preview[0];
    const p = predictGoal(model, { activity: w.activity, now: w.startedAt, tzOffset: w.tzOffset ?? 0, lat, lon });
    if (!p.goalM) continue;
    w.prediction = { goalM: p.goalM, source: p.source, routineId: p.routineId }; // as the app records it
    goals++;
    const hit = Math.abs(w.summary.distance - p.goalM) / p.goalM <= 0.1;
    if (hit) hits++;
    bySource[p.source][0]++;
    if (hit) bySource[p.source][1]++;
  }
  return { workouts: sorted.length, goals, hits, coverage: goals / sorted.length, precision: goals ? hits / goals : 1, bySource };
}

export const SCENARIOS = {
  typical: (seed) => makeHistory({ seed, weeks: 26, ...TYPICAL }),
  'noise only': (seed) => makeHistory({ seed, weeks: 26, routines: [], oneOffsPerWeek: 4 }),
  'noise from home': (seed) => makeHistory({ seed, weeks: 26, routines: [], oneOffsPerWeek: 4, oneOffFrom: HOME }),
  'two routes, same start and time': (seed) =>
    makeHistory({
      seed,
      weeks: 26,
      oneOffsPerWeek: 0,
      routines: [
        { activity: 'run', weekdays: [1, 3, 5], hour: 6, minute: 30, shape: 'loop', from: HOME, bearing: 10, distanceM: 5000, p: 0.5 },
        { activity: 'run', weekdays: [1, 3, 5], hour: 6, minute: 30, shape: 'loop', from: HOME, bearing: 190, distanceM: 9000, p: 0.5 },
      ],
    }),
  'habit change': (seed) => [
    ...makeHistory({ seed, weeks: 12, oneOffsPerWeek: 0, routines: [{ activity: 'run', weekdays: [2, 4, 6], hour: 7, minute: 0, shape: 'loop', from: PARK, bearing: 0, distanceM: 6000 }] }),
    ...makeHistory({
      seed: seed + 50,
      startDay: Date.UTC(2026, 3, 1),
      weeks: 12,
      oneOffsPerWeek: 0,
      routines: [{ activity: 'run', weekdays: [2, 4, 6], hour: 7, minute: 0, shape: 'outback', from: PARK, bearing: 120, distanceM: 12000 }],
    }).map((w) => ({ ...w, id: `b${w.id}` })),
  ],
};

function report(name, r) {
  const pct = (x) => `${Math.round(x * 100)}%`;
  const src = Object.entries(r.bySource)
    .filter(([, [n]]) => n)
    .map(([k, [n, h]]) => `${k} ${h}/${n}`)
    .join(', ');
  console.log(`${name.padEnd(34)} ${String(r.workouts).padStart(4)} workouts  goals ${String(r.goals).padStart(3)} (coverage ${pct(r.coverage).padStart(4)})  precision ${pct(r.precision).padStart(4)}${src ? `  [${src}]` : ''}`);
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('evaluate-goals.mjs')) {
  for (const [name, make] of Object.entries(SCENARIOS)) {
    const total = { workouts: 0, goals: 0, hits: 0, bySource: { route: [0, 0], time: [0, 0] } };
    for (let seed = 1; seed <= 5; seed++) {
      const r = replay(make(seed));
      total.workouts += r.workouts;
      total.goals += r.goals;
      total.hits += r.hits;
      for (const k of ['route', 'time']) for (const j of [0, 1]) total.bySource[k][j] += r.bySource[k][j];
    }
    report(name, { ...total, coverage: total.goals / total.workouts, precision: total.goals ? total.hits / total.goals : 1 });
  }
  if (process.argv[2]) {
    const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    report(`real: ${process.argv[2]}`, replay(Array.isArray(data) ? data : data.workouts));
  }
}

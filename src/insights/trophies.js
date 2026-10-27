// Personal-best trophies: the quickest workout of each routine, shown as a gold cup on the
// Home and History rows and celebrated when its Summary opens. Pure, so it is unit-tested.

import { routineChoices } from './routines.js';

/**
 * A workout only competes when it went about the routine's usual distance: routines allow
 * ±12% between workouts, so a cut-short walk would otherwise always be the "quickest".
 */
export const PB_MIN_DISTANCE_SHARE = 0.97;

/**
 * The quickest workout (lowest Time, i.e. active duration) of every routine with at least two
 * workouts. A tie goes to the earlier workout, which set the time first.
 * @param {object|null} model  the learned routine model (insights/model.js)
 * @param {object[]} workouts  workout records
 * @returns {Map<string, {routineId: string, routineName: string, duration: number}>} by workout id
 */
export function routineBests(model, workouts) {
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const out = new Map();
  for (const act of Object.keys(model?.activities ?? {})) {
    for (const r of routineChoices(model, act)) {
      const ms = r.workoutIds.map((id) => byId.get(id)).filter((w) => w?.summary?.duration > 0);
      if (ms.length < 2) continue;
      let best = null;
      for (const w of ms) {
        if (w.summary.distance < PB_MIN_DISTANCE_SHARE * r.medianM) continue;
        if (!best || w.summary.duration < best.summary.duration || (w.summary.duration === best.summary.duration && w.startedAt < best.startedAt)) best = w;
      }
      if (best) out.set(best.id, { routineId: r.id, routineName: r.name, duration: best.summary.duration });
    }
  }
  return out;
}

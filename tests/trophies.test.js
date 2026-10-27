import { describe, expect, it } from 'vitest';
import { routineBests } from '../src/insights/trophies.js';

const w = (id, distance, duration, startedAt = 0) => ({ id, activity: 'walk', startedAt, summary: { distance, duration } });
const model = (routines) => ({ activities: { walk: { routines: routines.map((r) => ({ eligible: true, medianM: 5000, ...r })) } } });

describe('routineBests', () => {
  it('gives each routine its quickest workout', () => {
    const ws = [w('a', 5000, 3000), w('b', 5050, 2900), w('c', 4990, 2950), w('x', 8000, 4800), w('y', 8000, 4700)];
    const m = model([
      { id: 'r1', name: 'lake loop', workoutIds: ['a', 'b', 'c'] },
      { id: 'r2', name: 'hill', medianM: 8000, workoutIds: ['x', 'y'] },
    ]);
    const bests = routineBests(m, ws);
    expect([...bests.keys()].sort()).toEqual(['b', 'y']);
    expect(bests.get('b')).toEqual({ routineId: 'r1', routineName: 'lake loop', duration: 2900 });
  });

  it('ignores workouts cut short of the usual distance', () => {
    const bests = routineBests(model([{ id: 'r1', name: 'loop', workoutIds: ['a', 'short'] }]), [w('a', 5000, 3000), w('short', 4600, 2700)]);
    expect([...bests.keys()]).toEqual(['a']);
  });

  it('needs two workouts, skips routines that are neither eligible nor marked, and breaks ties by date', () => {
    expect(routineBests(model([{ id: 'r1', name: 'one', workoutIds: ['a'] }]), [w('a', 5000, 3000)]).size).toBe(0);
    expect(routineBests(model([{ id: 'r1', name: 'n', eligible: false, workoutIds: ['a', 'b'] }]), [w('a', 5000, 3000), w('b', 5000, 2900)]).size).toBe(0);
    const tie = routineBests(model([{ id: 'r1', name: 't', workoutIds: ['late', 'early'] }]), [w('late', 5000, 3000, 2), w('early', 5000, 3000, 1)]);
    expect([...tie.keys()]).toEqual(['early']);
    expect(routineBests(null, []).size).toBe(0);
  });
});

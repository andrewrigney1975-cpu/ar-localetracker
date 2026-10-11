import { describe, expect, it } from 'vitest';
import { fastestSplit, personalBests } from '../src/insights/bests.js';

/** A straight track at the given speeds (m/s), one point per second. */
function track(speeds) {
  const n = speeds.length + 1;
  const t = { n, dist: new Float64Array(n), active: new Float64Array(n), alt: new Float64Array(n), speed: new Float32Array(n), hr: null };
  for (let i = 1; i < n; i++) {
    t.dist[i] = t.dist[i - 1] + speeds[i - 1];
    t.active[i] = i;
    t.speed[i] = speeds[i - 1];
  }
  return t;
}

const w = (id, activity, summary, startedAt = 0) => ({ id, activity, startedAt, summary });

describe('personal bests', () => {
  it('finds the fastest full split, ignoring the partial one at the end', () => {
    // 1 km at 4 m/s (250 s), 1 km at 5 m/s (200 s), then 600 m at 10 m/s.
    const t = track([...Array(250).fill(4), ...Array(200).fill(5), ...Array(60).fill(10)]);
    expect(fastestSplit(t, 1000)).toBeCloseTo(200, 0);
    expect(fastestSplit(track(Array(100).fill(5)), 1000)).toBeNull();
  });

  it('picks each best per activity, with the workout it came from', () => {
    const workouts = [
      w('r1', 'run', { distance: 5000, movingTime: 1500, avgMovingSpeed: 5000 / 1500, maxSpeed: 5.1 }, 1),
      w('r2', 'run', { distance: 10000, movingTime: 3300, avgMovingSpeed: 10000 / 3300, maxSpeed: 6.2 }, 2),
      // Fast, but too short to count for average pace.
      w('r3', 'run', { distance: 400, movingTime: 70, avgMovingSpeed: 400 / 70, maxSpeed: 6 }, 3),
      w('c1', 'cycle', { distance: 40000, movingTime: 5400, avgMovingSpeed: 40000 / 5400, maxSpeed: 15 }, 4),
    ];
    const splits = new Map([
      ['r1', { km: 290, mi: 470 }],
      ['r2', { km: 300, mi: 480 }],
    ]);
    const [run, cycle] = personalBests(workouts, splits, 'metric');
    expect(run).toMatchObject({
      activity: 'run',
      count: 3,
      avgSpeed: { id: 'r1' },
      split: { id: 'r1', value: 290 },
      maxSpeed: { id: 'r2', value: 6.2 },
      longest: { id: 'r2', value: 10000 },
    });
    expect(cycle).toMatchObject({ activity: 'cycle', longest: { id: 'c1' }, split: null });
    expect(personalBests(workouts, splits, 'imperial')[0].split).toMatchObject({ id: 'r1', value: 470 });
  });

  it('has no pace or split bests for skiing (lifts count as time)', () => {
    const [ski] = personalBests([w('s1', 'ski', { distance: 30000, movingTime: 9000, maxSpeed: 20 })], new Map([['s1', { km: 60, mi: 99 }]]));
    expect(ski).toMatchObject({ avgSpeed: null, split: null, maxSpeed: { value: 20 }, longest: { value: 30000 } });
  });
});

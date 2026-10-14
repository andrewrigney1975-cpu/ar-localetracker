import { describe, expect, it } from 'vitest';
import { goalList, goalValue, withGoals } from '../src/insights/goals.js';

describe('goals', () => {
  it('stores goals per activity and period, dropping empty ones', () => {
    let g = withGoals({}, 'run', 'week', { distance: 20000, time: 0, cardioLoad: null, calories: 1500 });
    expect(g).toEqual({ 'run.week': { distance: 20000, calories: 1500 } });
    g = withGoals(g, 'all', 'day', { time: 1800 });
    expect(goalValue(g, 'run', 'week', 'distance')).toBe(20000);
    expect(goalValue(g, 'run', 'week', 'time')).toBeNull();
    expect(goalValue(g, 'all', 'day', 'time')).toBe(1800);
    // No goals for Insights' 3-month and yearly groupings.
    expect(goalValue(g, 'run', 'quarter', 'distance')).toBeNull();
    expect(withGoals(g, 'run', 'week', {})).toEqual({ 'all.day': { time: 1800 } });
  });

  it('lists All first, then activities, by day, week and month', () => {
    const g = { 'run.month': { distance: 1 }, 'run.week': { distance: 1 }, 'all.week': { time: 1 }, 'walk.day': { calories: 1 } };
    expect(goalList(g).map((x) => `${x.activity}.${x.period}`)).toEqual(['all.week', 'walk.day', 'run.week', 'run.month']);
  });
});

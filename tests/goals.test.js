import { describe, expect, it } from 'vitest';
import { combinedGoalForPeriod, goalForPeriod, goalForWindow, goalList, goalValue, withGoals } from '../src/insights/goals.js';
import { nextPeriod } from '../src/insights/report.js';

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

  it('scales a goal set for another period to the chart period', () => {
    const g = { 'walk.week': { distance: 126000 }, 'run.month': { distance: 310000 }, 'run.day': { time: 1800 } };
    const tue = new Date(2026, 9, 13).getTime();
    expect(goalForPeriod(g, 'walk', 'day', 'distance', tue, nextPeriod)).toEqual({ value: 18000, from: 'week' });
    // October has 31 days: a 310 km month is 10 km a day and 70 km a week.
    expect(goalForPeriod(g, 'run', 'day', 'distance', tue, nextPeriod)).toEqual({ value: 10000, from: 'month' });
    expect(goalForPeriod(g, 'run', 'week', 'distance', new Date(2026, 9, 11).getTime(), nextPeriod).value).toBeCloseTo(70000);
    expect(goalForPeriod(g, 'run', 'month', 'distance', new Date(2026, 9, 1).getTime(), nextPeriod)).toEqual({ value: 310000, from: 'month' });
    // A week goal over a 30-day month; a day goal over a week.
    expect(goalForPeriod(g, 'walk', 'month', 'distance', new Date(2026, 10, 1).getTime(), nextPeriod).value).toBeCloseTo(540000);
    expect(goalForPeriod(g, 'run', 'week', 'time', new Date(2026, 9, 11).getTime(), nextPeriod).value).toBe(12600);
    expect(goalForPeriod(g, 'cycle', 'day', 'distance', tue, nextPeriod)).toBeNull();
  });

  it("adds up the activities' goals for all activities, unless an All goal is set", () => {
    const tue = new Date(2026, 9, 13).getTime();
    const g = { 'walk.week': { distance: 126000 }, 'run.day': { distance: 5000 }, 'cycle.week': { time: 3600 } };
    expect(combinedGoalForPeriod(g, 'day', 'distance', tue, nextPeriod)).toEqual({ value: 23000, from: 'day', activities: ['walk', 'run'] });
    expect(combinedGoalForPeriod({ ...g, 'all.week': { distance: 70000 } }, 'day', 'distance', tue, nextPeriod)).toEqual({ value: 10000, from: 'week' });
    expect(combinedGoalForPeriod(g, 'day', 'calories', tue, nextPeriod)).toBeNull();
  });
});

describe('goal for an Insights window', () => {
  const day = (y, m, d) => new Date(y, m - 1, d).getTime();
  const goals = { 'run.week': { distance: 21000 }, 'walk.month': { distance: 62000 } };

  it("takes the window's own period, scaled when that one isn't set", () => {
    expect(goalForWindow(goals, 'run', 'distance', 'week', day(2026, 10, 11), day(2026, 10, 17), nextPeriod)).toEqual({ value: 21000 });
    expect(goalForWindow(goals, 'run', 'distance', 'day', day(2026, 10, 17), day(2026, 10, 17), nextPeriod)).toEqual({ value: 3000 });
    expect(goalForWindow(goals, 'walk', 'distance', 'month', day(2026, 10, 1), day(2026, 10, 31), nextPeriod)).toEqual({ value: 62000 });
    expect(goalForWindow(goals, 'cycle', 'distance', 'week', day(2026, 10, 11), day(2026, 10, 17), nextPeriod)).toBeNull();
  });

  it('adds up the days of a longer window, and the activities for All', () => {
    // 1 Sep – 31 Oct: 61 days of 3 km.
    expect(goalForWindow(goals, 'run', 'distance', null, day(2026, 9, 1), day(2026, 10, 31), nextPeriod).value).toBeCloseTo(61 * 3000, 6);
    // All: run's 21 km a week plus walk's 62 km over October's 31 days, for one week.
    const all = goalForWindow(goals, 'all', 'distance', 'week', day(2026, 10, 11), day(2026, 10, 17), nextPeriod);
    expect(all.value).toBeCloseTo(21000 + 14000, 6);
    expect(all.activities).toEqual(['walk', 'run']);
    // An All-activities goal covers everything.
    expect(goalForWindow({ ...goals, 'all.week': { distance: 50000 } }, 'all', 'distance', 'week', day(2026, 10, 11), day(2026, 10, 17), nextPeriod)).toEqual({ value: 50000 });
  });
});

// Goals: targets for distance, activity time, cardio load and calories per day, week or
// month, for one activity or all of them. Stored in settings().goals as
// {"run.week": {distance: 20000, time: 7200}} in SI units (metres, seconds). Insights draws
// the goal for its chart's grouping, scaled from another period when that one isn't set;
// WeekGoal.java reads distance goals for the 4×2 widget the same way.

export const GOAL_PERIODS = [
  { id: 'day', label: 'Per day', noun: 'day' },
  { id: 'week', label: 'Per week', noun: 'week' },
  { id: 'month', label: 'Per month', noun: 'month' },
];

/** Metric ids as in report.js METRICS. */
export const GOAL_METRICS = ['distance', 'time', 'cardioLoad', 'calories'];

/** 'all' or an activity id. */
export const GOAL_ACTIVITIES = ['all', 'walk', 'run', 'cycle', 'ski'];

export const goalKey = (activity, period) => `${activity}.${period}`;

/** The goal for this activity, period and metric, or null if none is set. */
export function goalValue(goals, activity, period, metric) {
  const v = goals?.[goalKey(activity, period)]?.[metric];
  return v > 0 ? v : null;
}

/** All of the goals for one activity and period ({} when none). */
export function goalsFor(goals, activity, period) {
  return { ...goals?.[goalKey(activity, period)] };
}

/** `goals` with this activity and period's goals replaced; empty or zero values are dropped. */
export function withGoals(goals, activity, period, values) {
  const kept = Object.fromEntries(GOAL_METRICS.filter((m) => values?.[m] > 0).map((m) => [m, values[m]]));
  const out = { ...goals };
  if (Object.keys(kept).length) out[goalKey(activity, period)] = kept;
  else delete out[goalKey(activity, period)];
  return out;
}

/** Set goals in display order: All first, then by activity, then day, week, month. */
export function goalList(goals) {
  const out = [];
  for (const activity of GOAL_ACTIVITIES) {
    for (const { id: period } of GOAL_PERIODS) {
      const values = goalsFor(goals, activity, period);
      if (GOAL_METRICS.some((m) => values[m] > 0)) out.push({ activity, period, values });
    }
  }
  return out;
}

const DAY_MS = 86400000;
/** Goal periods to scale from when the chart's own isn't set, as WeekGoal.java does. */
const SCALE_ORDER = ['week', 'day', 'month'];

/** Days in the goal period containing `ms`: 1, 7, or the length of its month (local time). */
function periodDays(period, ms) {
  if (period === 'day') return 1;
  if (period === 'week') return 7;
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/**
 * The goal for one chart period: the goal set for that period, else one set for another
 * period scaled by length (a week goal is 1/7 per day; a month goal is spread over its days).
 * @param {number} start  the chart period's start (local midnight)
 * @param {(start:number, group:string) => number} nextPeriod  report.js nextPeriod
 * @returns {{value:number, from:string}|null} from: the period the goal was set for
 */
export function goalForPeriod(goals, activity, group, metric, start, nextPeriod) {
  const exact = goalValue(goals, activity, group, metric);
  if (exact != null) return { value: exact, from: group };
  const days = Math.round((nextPeriod(start, group) - start) / DAY_MS);
  for (const from of SCALE_ORDER) {
    const v = goalValue(goals, activity, from, metric);
    if (v != null) return { value: (v * days) / periodDays(from, start), from };
  }
  return null;
}

/**
 * The goal for one chart period across every activity: the All-activities goal if set, else
 * the activities' goals added up (each scaled as in goalForPeriod), as the 4×2 widget does.
 * @returns {{value:number, from:string, activities?:string[]}|null} activities: whose goals were added
 */
export function combinedGoalForPeriod(goals, group, metric, start, nextPeriod) {
  const all = goalForPeriod(goals, 'all', group, metric, start, nextPeriod);
  if (all) return all;
  let value = 0;
  const activities = [];
  for (const a of GOAL_ACTIVITIES.slice(1)) {
    const g = goalForPeriod(goals, a, group, metric, start, nextPeriod);
    if (!g) continue;
    value += g.value;
    activities.push(a);
  }
  return activities.length ? { value, from: group, activities } : null;
}

// Goals: targets for distance, activity time, cardio load and calories per day, week or
// month, for one activity or all of them. Stored in settings().goals as
// {"run.week": {distance: 20000, time: 7200}} in SI units (metres, seconds). Insights draws
// the goal matching its chart; LocaleWidgets.java reads distance goals for the 4×2 widget.

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

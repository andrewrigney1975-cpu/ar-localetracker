// Date-based workout reports for the Insights screen: totals and averages per day, week,
// month, quarter or year, optionally split by activity, plus CSV and JSON export.
// Pure (no I/O); per-workout calories and cardio load come in from effort.js.

import { ACTIVITY_IDS } from '../activities.js';

export const GROUPINGS = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: '3 months' },
  { id: 'year', label: 'Year' },
];

export const METRICS = [
  { id: 'distance', label: 'Distance', sum: true },
  { id: 'speed', label: 'Speed', sum: false },
  { id: 'pace', label: 'Pace', sum: false },
  { id: 'time', label: 'Activity time', sum: true },
  { id: 'heartRate', label: 'Heart rate', sum: false },
  { id: 'cardioLoad', label: 'Cardio load', sum: true },
  { id: 'calories', label: 'Calories', sum: true },
];

const MI = 1609.344;

// ---- Periods (local time) --------------------------------------------------------------------

/** Start of the period containing `ms` (local midnight; weeks start on Monday). */
export function periodStart(ms, group) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = d.getMonth();
  switch (group) {
    case 'day':
      return new Date(y, m, d.getDate()).getTime();
    case 'week':
      return new Date(y, m, d.getDate() - ((d.getDay() + 6) % 7)).getTime();
    case 'month':
      return new Date(y, m, 1).getTime();
    case 'quarter':
      return new Date(y, m - (m % 3), 1).getTime();
    case 'year':
      return new Date(y, 0, 1).getTime();
    default:
      throw new Error(`Unknown grouping: ${group}`);
  }
}

/** Start of the period after the one starting at `start`. */
export function nextPeriod(start, group) {
  const d = new Date(start);
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  switch (group) {
    case 'day':
      return new Date(y, m, day + 1).getTime();
    case 'week':
      return new Date(y, m, day + 7).getTime();
    case 'month':
      return new Date(y, m + 1, 1).getTime();
    case 'quarter':
      return new Date(y, m + 3, 1).getTime();
    case 'year':
      return new Date(y + 1, 0, 1).getTime();
    default:
      throw new Error(`Unknown grouping: ${group}`);
  }
}

/** Local calendar date as YYYY-MM-DD. */
export function isoDate(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local midnight for a YYYY-MM-DD string. */
export function parseIsoDate(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Long label for a period ("Week of 6 Oct 2026", "Q4 2026"). */
export function periodLabel(start, group) {
  const d = new Date(start);
  const date = (o) => d.toLocaleDateString([], o);
  switch (group) {
    case 'day':
      return date({ weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    case 'week':
      return `Week of ${date({ day: 'numeric', month: 'short', year: 'numeric' })}`;
    case 'month':
      return date({ month: 'long', year: 'numeric' });
    case 'quarter':
      return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
    default:
      return String(d.getFullYear());
  }
}

/** Short label for chart ticks ("6 Oct", "Oct", "Q4 '26", "2026"). */
export function periodTick(start, group) {
  const d = new Date(start);
  switch (group) {
    case 'day':
    case 'week':
      return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
    case 'month':
      return d.toLocaleDateString([], { month: 'short' });
    case 'quarter':
      return `Q${Math.floor(d.getMonth() / 3) + 1} '${String(d.getFullYear()).slice(2)}`;
    default:
      return String(d.getFullYear());
  }
}

// ---- Aggregation -----------------------------------------------------------------------------

/**
 * One report entry per workout, from the stored record and its effort values.
 * @param {object} w  workout record
 * @param {{kcal?:number|null, load?:number|null}} [effort]
 */
export function reportEntry(w, effort = {}) {
  const s = w.summary ?? {};
  return {
    id: w.id,
    activity: w.activity,
    startedAt: w.startedAt,
    distance: s.distance ?? 0,
    duration: s.duration ?? 0,
    movingTime: s.movingTime ?? 0,
    hrAvg: s.heartRate?.avg ?? null,
    hrMax: s.heartRate?.max ?? null,
    kcal: effort.kcal ?? null,
    load: effort.load ?? null,
  };
}

function emptyBucket() {
  return { workouts: 0, distance: 0, duration: 0, movingTime: 0, hrWeighted: 0, hrTime: 0, hrMax: null, kcal: null, load: null };
}

function addTo(b, e) {
  b.workouts++;
  b.distance += e.distance;
  b.duration += e.duration;
  b.movingTime += e.movingTime;
  if (e.hrAvg != null && e.duration > 0) {
    b.hrWeighted += e.hrAvg * e.duration;
    b.hrTime += e.duration;
  }
  if (e.hrMax != null) b.hrMax = Math.max(b.hrMax ?? 0, e.hrMax);
  if (e.kcal != null) b.kcal = (b.kcal ?? 0) + e.kcal;
  if (e.load != null) b.load = (b.load ?? 0) + e.load;
}

function finish(b) {
  // Speed over moving time, as on a workout's summary; pace is its inverse.
  const speed = b.movingTime > 0 ? b.distance / b.movingTime : null;
  return {
    workouts: b.workouts,
    distanceM: b.distance,
    activityTimeS: b.duration,
    movingTimeS: b.movingTime,
    avgSpeedMps: speed,
    avgPaceSPerKm: speed ? 1000 / speed : null,
    avgPaceSPerMi: speed ? MI / speed : null,
    avgHrBpm: b.hrTime > 0 ? b.hrWeighted / b.hrTime : null,
    maxHrBpm: b.hrMax,
    cardioLoad: b.load,
    caloriesKcal: b.kcal,
  };
}

/**
 * Build a report. Every period from `from` to `to` gets a row (empty ones have 0 workouts),
 * so charts keep an even time axis.
 * @param {object[]} entries  from reportEntry
 * @param {{from:number, to:number, group:string, activity?:string, split?:boolean}} opts
 *   from/to inclusive local-day bounds in ms; activity 'all' or an id; split → per-activity rows too
 * @returns {{periods: {start:number, end:number, label:string, total:object, byActivity?:Record<string,object>}[], total:object, activities:string[]}}
 */
export function buildReport(entries, { from, to, group, activity = 'all', split = false }) {
  const toEnd = nextPeriod(to, 'day');
  const picked = entries.filter((e) => e.startedAt >= from && e.startedAt < toEnd && (activity === 'all' || e.activity === activity));
  const activities = ACTIVITY_IDS.filter((id) => picked.some((e) => e.activity === id));
  const periods = [];
  const index = new Map();
  for (let start = periodStart(from, group); start < toEnd; start = nextPeriod(start, group)) {
    const p = { start, end: nextPeriod(start, group), total: emptyBucket() };
    if (split) p.byActivity = {};
    index.set(start, p);
    periods.push(p);
  }
  const overall = emptyBucket();
  for (const e of picked) {
    const p = index.get(periodStart(e.startedAt, group));
    if (!p) continue;
    addTo(p.total, e);
    addTo(overall, e);
    if (split) addTo((p.byActivity[e.activity] ??= emptyBucket()), e);
  }
  return {
    group,
    from,
    to,
    activity,
    split,
    activities,
    total: finish(overall),
    periods: periods.map((p) => ({
      start: p.start,
      end: p.end,
      label: periodLabel(p.start, group),
      total: finish(p.total),
      ...(split ? { byActivity: Object.fromEntries(Object.entries(p.byActivity).map(([a, b]) => [a, finish(b)])) } : {}),
    })),
  };
}

/** Chart/table value for a metric from a finished bucket (SI; pace in s per km). */
export function metricValue(row, metric) {
  switch (metric) {
    case 'distance':
      return row.distanceM;
    case 'speed':
      return row.avgSpeedMps;
    case 'pace':
      return row.avgPaceSPerKm;
    case 'time':
      return row.activityTimeS;
    case 'heartRate':
      return row.avgHrBpm;
    case 'cardioLoad':
      return row.cardioLoad;
    case 'calories':
      return row.caloriesKcal;
    default:
      return null;
  }
}

// ---- Export ----------------------------------------------------------------------------------

const FIELDS = [
  ['workouts', 'workouts', 0],
  ['distanceM', 'distance_m', 1],
  ['activityTimeS', 'activity_time_s', 0],
  ['movingTimeS', 'moving_time_s', 0],
  ['avgSpeedMps', 'avg_speed_mps', 3],
  ['avgPaceSPerKm', 'avg_pace_s_per_km', 1],
  ['avgPaceSPerMi', 'avg_pace_s_per_mi', 1],
  ['avgHrBpm', 'avg_hr_bpm', 1],
  ['maxHrBpm', 'max_hr_bpm', 0],
  ['cardioLoad', 'cardio_load', 1],
  ['caloriesKcal', 'calories_kcal', 0],
];

const round = (v, d) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Rows that have workouts, oldest first: one per period, or per period and activity when split. */
export function exportRows(report) {
  const rows = [];
  for (const p of report.periods) {
    if (!p.total.workouts) continue;
    const base = { periodStart: isoDate(p.start), periodEnd: isoDate(p.end - 1), period: p.label };
    const groups = report.split ? ACTIVITY_IDS.filter((a) => p.byActivity[a]).map((a) => [a, p.byActivity[a]]) : [[report.activity, p.total]];
    for (const [activity, b] of groups) {
      const row = { ...base, activity };
      for (const [key, , d] of FIELDS) row[key] = round(b[key], d);
      rows.push(row);
    }
  }
  return rows;
}

const csvCell = (v) => {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function reportToCSV(report) {
  const header = ['period_start', 'period_end', 'period', 'activity', ...FIELDS.map(([, name]) => name)];
  const lines = [header.join(',')];
  for (const r of exportRows(report)) {
    lines.push([r.periodStart, r.periodEnd, r.period, r.activity, ...FIELDS.map(([key]) => r[key])].map(csvCell).join(','));
  }
  return lines.join('\n') + '\n';
}

export function reportToJSON(report, { generatedAt = Date.now() } = {}) {
  const totals = {};
  for (const [key, , d] of FIELDS) totals[key] = round(report.total[key], d);
  return (
    JSON.stringify(
      {
        generatedAt: new Date(generatedAt).toISOString(),
        from: isoDate(report.from),
        to: isoDate(report.to),
        grouping: report.group,
        activity: report.activity,
        splitByActivity: report.split,
        units: 'SI: metres, seconds, m/s; pace in seconds per km and per mile; heart rate in bpm; calories in kcal',
        totals,
        rows: exportRows(report),
      },
      null,
      2
    ) + '\n'
  );
}

export function reportFilename(report, ext) {
  return `locale-insights-${report.group}-${isoDate(report.from)}-to-${isoDate(report.to)}.${ext}`;
}

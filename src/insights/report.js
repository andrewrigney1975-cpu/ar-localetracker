// Date-based workout reports for the Insights screen: totals and averages per day, week,
// month, quarter or year, optionally split by activity, plus CSV and JSON export.
// Pure (no I/O); per-workout calories and cardio load come in from effort.js.

import { ACTIVITY_IDS } from '../activities.js';
import { csvCell } from '../export/csv.js';

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

/** Start of the period containing `ms` (local midnight; weeks run Sunday to Saturday). */
export function periodStart(ms, group) {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = d.getMonth();
  switch (group) {
    case 'day':
      return new Date(y, m, d.getDate()).getTime();
    case 'week':
      return new Date(y, m, d.getDate() - d.getDay()).getTime();
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

// ---- Date windows ----------------------------------------------------------------------------

export const WINDOWS = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
  { id: '3m', label: '3 months' },
  { id: '12m', label: '12 months' },
  { id: 'ytd', label: 'This year' },
  { id: 'all', label: 'All time' },
  { id: 'custom', label: 'Custom' },
];

const day = (y, m, d) => new Date(y, m, d).getTime();

/**
 * [from, to] local-day bounds (ms at midnight, both inclusive) for a date window, moved
 * `offset` windows back (negative) or forward from the current one.
 * - today: one day; week: Sunday to Saturday; month and year: calendar ones
 * - 3m / 12m: rolling, ending today (offset −1 is the 3 or 12 months before that)
 * - ytd ("This year"): 1 Jan to today; other offsets are whole years
 * - custom: from/to as given (YYYY-MM-DD); all: from `earliest` to today
 */
export function windowBounds(range, offset = 0, { now = Date.now(), earliest = null, from = null, to = null } = {}) {
  const n = new Date(now);
  const y = n.getFullYear();
  const m = n.getMonth();
  const d = n.getDate();
  const today = day(y, m, d);
  switch (range) {
    case 'today':
      return [day(y, m, d + offset), day(y, m, d + offset)];
    case 'week': {
      const sunday = d - n.getDay() + 7 * offset;
      return [day(y, m, sunday), day(y, m, sunday + 6)];
    }
    case 'month':
      return [day(y, m + offset, 1), day(y, m + offset + 1, 0)];
    case '3m':
    case '12m': {
      const len = range === '3m' ? 3 : 12;
      return [day(y, m - len + len * offset, d + 1), day(y, m + len * offset, d)];
    }
    case 'ytd':
      return offset === 0 ? [day(y, 0, 1), today] : [day(y + offset, 0, 1), day(y + offset, 11, 31)];
    case 'all':
      return [earliest != null ? periodStart(earliest, 'day') : today, today];
    default: {
      const f = from ? parseIsoDate(from) : day(y, m - 12, d + 1);
      const t = to ? parseIsoDate(to) : today;
      return f <= t ? [f, t] : [t, f];
    }
  }
}

/** Can the window move by `step` (−1 back, +1 forward)? Never past the current window. */
export function canShiftWindow(range, offset, step, opts = {}) {
  if (range === 'all') return false;
  if (step < 0) return true;
  if (range === 'custom') return windowBounds(range, 0, opts)[1] < windowBounds('today', 0, opts)[0];
  return offset < 0;
}

/** A custom window moved by its own length: new YYYY-MM-DD from/to. */
export function shiftCustom(from, to, step) {
  const f = parseIsoDate(from);
  const t = parseIsoDate(to);
  const fd = new Date(f);
  const td = new Date(t);
  const days = Math.round((t - f) / 86400000) + 1;
  return {
    from: isoDate(day(fd.getFullYear(), fd.getMonth(), fd.getDate() + days * step)),
    to: isoDate(day(td.getFullYear(), td.getMonth(), td.getDate() + days * step)),
  };
}

/** What the window shows, for the select: "Today", "Yesterday", "Last week", "August 2026"… */
export function windowLabel(range, offset, from, to) {
  const f = new Date(from);
  const t = new Date(to);
  const short = (dt, year) => dt.toLocaleDateString([], { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) });
  const span = () => `${short(f, f.getFullYear() !== t.getFullYear())} – ${short(t, true)}`;
  if (offset === 0) return WINDOWS.find((w) => w.id === range)?.label ?? 'Custom';
  switch (range) {
    case 'today':
      return offset === -1 ? 'Yesterday' : f.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
    case 'week':
      return offset === -1 ? 'Last week' : `Week of ${short(f, true)}`;
    case 'month':
      return offset === -1 ? 'Last month' : f.toLocaleDateString([], { month: 'long', year: 'numeric' });
    case 'ytd':
      return offset === -1 ? 'Last year' : String(f.getFullYear());
    default:
      return span();
  }
}

/** The window's dates in words ("Sun 4 Oct – Sat 10 Oct 2026"), shown under the controls. */
export function windowDates(from, to) {
  // Weekday and date formatted apart, so both ends read the same with or without a year.
  const fmt = (ms, year) => {
    const dt = new Date(ms);
    return `${dt.toLocaleDateString([], { weekday: 'short' })} ${dt.toLocaleDateString([], { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) })}`;
  };
  if (from === to) return fmt(to, true);
  const sameYear = new Date(from).getFullYear() === new Date(to).getFullYear();
  return `${fmt(from, !sameYear)} – ${fmt(to, true)}`;
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
  return { workouts: 0, distance: 0, duration: 0, movingTime: 0, speedN: 0, speedSq: 0, hrWeighted: 0, hrTime: 0, hrMax: null, kcal: null, load: null };
}

function addTo(b, e) {
  b.workouts++;
  b.distance += e.distance;
  b.duration += e.duration;
  b.movingTime += e.movingTime;
  if (e.movingTime > 0) {
    // Σ t·v² with v = d / t, for the spread of the workouts' speeds about the average.
    b.speedN++;
    b.speedSq += (e.distance * e.distance) / e.movingTime;
  }
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
  // The workouts' speeds weighted by moving time, as the average is: their standard deviation
  // as a percentage of it (null below two workouts).
  const variance = speed && b.speedN >= 2 ? Math.max(0, b.speedSq / b.movingTime - speed * speed) : null;
  return {
    workouts: b.workouts,
    distanceM: b.distance,
    activityTimeS: b.duration,
    movingTimeS: b.movingTime,
    avgSpeedMps: speed,
    avgPaceSPerKm: speed ? 1000 / speed : null,
    avgPaceSPerMi: speed ? MI / speed : null,
    speedSpreadPct: variance != null ? (Math.sqrt(variance) / speed) * 100 : null,
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

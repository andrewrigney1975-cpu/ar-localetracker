// Raw GPS distance from a workout's journal, against the saved (smoothed) distance, and the
// min/max/mean/SD statistics and CSV for Insights → Export → GPS distance (backlog 11).
// Pure, so it is unit-tested.

import { csvCell } from '../export/csv.js';
import { haversine } from '../geo/geo.js';

/** Fixes the phone rated at least this good count towards the "gated" raw distance. */
export const GATE_M = 20;

/**
 * Raw distances from a journal (NDJSON text): straight lines between consecutive `pt` fixes
 * in the same segment, every fix ("raw") and only fixes rated ±GATE_M or better ("gated"),
 * plus the average reported accuracy and satellites used.
 * @returns {{raw: number, gated: number, points: number, accuracy: number|null, satellites: number|null}|null}
 */
export function rawDistance(journalText) {
  let raw = 0;
  let gated = 0;
  let points = 0;
  let accSum = 0;
  let accN = 0;
  let svSum = 0;
  let svN = 0;
  let prev = null;
  let prevGood = null;
  for (const line of journalText.split('\n')) {
    if (!line.includes('"pt"')) continue;
    let p;
    try {
      p = JSON.parse(line);
    } catch {
      continue; // a torn last line
    }
    if (p.type !== 'pt' || !Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
    points++;
    if (Number.isFinite(p.ha)) {
      accSum += p.ha;
      accN++;
    }
    if (Number.isFinite(p.sv)) {
      svSum += p.sv;
      svN++;
    }
    const seg = p.seg ?? 0;
    if (prev && prev.seg === seg) raw += haversine(prev.lat, prev.lon, p.lat, p.lon);
    prev = { lat: p.lat, lon: p.lon, seg };
    if (Number.isFinite(p.ha) && p.ha <= GATE_M) {
      if (prevGood && prevGood.seg === seg) gated += haversine(prevGood.lat, prevGood.lon, p.lat, p.lon);
      prevGood = prev;
    }
  }
  if (!points) return null;
  return { raw, gated, points, accuracy: accN ? accSum / accN : null, satellites: svN ? svSum / svN : null };
}

/**
 * n, min, max, mean, sample standard deviation and coefficient of variation (SD ÷ mean, %).
 * SD and CV need at least 2 values.
 */
export function describe(values) {
  const xs = values.filter(Number.isFinite);
  const n = xs.length;
  if (!n) return { n: 0, min: null, max: null, mean: null, sd: null, cv: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const sd = n > 1 ? Math.sqrt(xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (n - 1)) : null;
  return { n, min: Math.min(...xs), max: Math.max(...xs), mean, sd, cv: sd != null && mean ? (sd / mean) * 100 : null };
}

/** The series summarised per group. Distances in metres; the excess is raw over smoothed, %. */
export const SERIES = [
  ['raw', 'Raw GPS', 'm'],
  ['gated', `Raw GPS, fixes ≤ ±${GATE_M} m`, 'm'],
  ['smoothed', 'Smoothed (saved)', 'm'],
  ['excess', 'Raw over smoothed', '%'],
];

/**
 * Statistics per group of workouts, in the order the groups first appear. With more than one
 * group, an "All workouts" group follows with the excess only: distances across different
 * routes don't make a meaningful spread, but how much longer raw GPS reads does.
 * @param {{group: string, raw: number, gated: number, smoothed: number}[]} rows
 */
export function groupStats(rows) {
  const groups = [...new Set(rows.map((r) => r.group))];
  const withExcess = rows.map((r) => ({ ...r, excess: r.smoothed > 0 ? ((r.raw - r.smoothed) / r.smoothed) * 100 : null }));
  const out = [];
  for (const g of groups) {
    const mine = withExcess.filter((r) => r.group === g);
    for (const [key, label, unit] of SERIES) out.push({ group: g, series: label, unit, ...describe(mine.map((r) => r[key])) });
  }
  if (groups.length > 1) {
    const [key, label, unit] = SERIES[3];
    out.push({ group: 'All workouts', series: label, unit, ...describe(withExcess.map((r) => r[key])) });
  }
  return out;
}

const fixed = (v, d) => (v == null || !Number.isFinite(v) ? null : v.toFixed(d));

/**
 * The CSV: a statistics block (one row per group and series), a blank line, then one row
 * per workout. `rows` items: {startedAt, name, activity, group, raw, gated, smoothed,
 * accuracy, satellites, points, weather}. `localTime(ms)` → [date, time] strings.
 */
export function gpsStatsCSV(rows, { localTime }) {
  const lines = [['group', 'series', 'unit', 'n', 'min', 'max', 'mean', 'sd', 'cv_pct'].join(',')];
  for (const s of groupStats(rows)) {
    const d = s.unit === '%' ? 2 : 1;
    lines.push([s.group, s.series, s.unit, s.n, fixed(s.min, d), fixed(s.max, d), fixed(s.mean, d), fixed(s.sd, d), fixed(s.cv, 2)].map(csvCell).join(','));
  }
  lines.push('');
  lines.push(
    [
      'date',
      'start',
      'name',
      'activity',
      'group',
      'raw_m',
      'raw_gated_m',
      'smoothed_m',
      'raw_minus_smoothed_m',
      'raw_over_smoothed_pct',
      'avg_accuracy_m',
      'avg_satellites',
      'points',
      'weather',
      'temp_c',
      'wind_kmh',
    ].join(',')
  );
  for (const r of [...rows].sort((a, b) => a.startedAt - b.startedAt)) {
    const [date, time] = localTime(r.startedAt);
    const wx = r.weather && !r.weather.unavailable ? r.weather : null;
    lines.push(
      [
        date,
        time,
        r.name,
        r.activity,
        r.group,
        fixed(r.raw, 1),
        fixed(r.gated, 1),
        fixed(r.smoothed, 1),
        fixed(r.raw - r.smoothed, 1),
        fixed(r.smoothed > 0 ? ((r.raw - r.smoothed) / r.smoothed) * 100 : null, 2),
        fixed(r.accuracy, 1),
        fixed(r.satellites, 1),
        r.points,
        wx?.condition,
        fixed(wx?.tempC, 1),
        fixed(wx?.windMs == null ? null : wx.windMs * 3.6, 0),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return lines.join('\n') + '\n';
}

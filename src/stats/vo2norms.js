// VO2max norms by age and sex, for rating an estimate (You → Profile chart).
//
// Percentiles from The Cooper Institute's Aerobics Center Longitudinal Study (maximal
// treadmill tests with gas analysis), as published in ACSM's Guidelines for Exercise Testing
// and Prescription, 11th ed., Table 4.7, and tabulated at https://vo2maxcalculators.com/chart/.
// ml·kg⁻¹·min⁻¹ at the 5th, 10th, 25th, 50th, 75th, 90th and 95th percentiles.
//
// Categories follow that page's ACSM bands (Poor < 20th, Fair 20–39th, Average 40–59th, Good
// 60–79th, Excellent 80–94th, Superior ≥ 95th), relabelled to the seven the user asked for:
// Poor is split at the 10th into Very Poor and Poor, Excellent → Very Good, Superior →
// Excellent. Values between listed percentiles are interpolated linearly, as the page does.

export const NORM_PERCENTILES = [5, 10, 25, 50, 75, 90, 95];

const BANDS = [
  [20, 29],
  [30, 39],
  [40, 49],
  [50, 59],
  [60, 69],
  [70, 79],
];

const TABLES = {
  male: [
    [29.0, 32.1, 40.1, 48.0, 55.2, 61.8, 66.3],
    [27.2, 30.2, 35.9, 42.4, 49.2, 56.5, 59.8],
    [24.2, 26.8, 31.9, 37.8, 45.0, 52.1, 55.6],
    [20.9, 22.8, 27.1, 32.6, 39.7, 45.6, 50.7],
    [17.4, 19.8, 23.7, 28.2, 34.5, 40.3, 43.0],
    [16.3, 17.1, 20.4, 24.4, 30.4, 36.6, 39.7],
  ],
  female: [
    [21.7, 23.9, 30.5, 37.6, 44.7, 51.3, 56.0],
    [19.0, 20.9, 25.3, 30.2, 36.1, 41.4, 45.8],
    [17.0, 18.8, 22.1, 26.7, 32.4, 38.4, 41.7],
    [16.0, 17.3, 19.9, 23.4, 27.6, 32.0, 35.9],
    [13.4, 14.6, 17.2, 20.0, 23.8, 27.0, 29.4],
    [13.1, 13.6, 15.6, 18.3, 20.8, 23.1, 24.1],
  ],
};

/** Categories as percentile ranges [from, to), lowest first. */
export const VO2_CATEGORIES = [
  { label: 'Very Poor', from: 0, to: 10 },
  { label: 'Poor', from: 10, to: 20 },
  { label: 'Fair', from: 20, to: 40 },
  { label: 'Average', from: 40, to: 60 },
  { label: 'Good', from: 60, to: 80 },
  { label: 'Very Good', from: 80, to: 95 },
  { label: 'Excellent', from: 95, to: 100 },
];

/**
 * The norms table for a sex and age. Ages outside 20–79 use the nearest band (`clamped`).
 * @returns {{band:string, values:number[], clamped:boolean} | null}
 */
export function normsFor(sex, age) {
  const table = TABLES[sex];
  if (!table || !Number.isFinite(age)) return null;
  let i = BANDS.findIndex(([lo, hi]) => age >= lo && age <= hi);
  const clamped = i < 0;
  if (clamped) i = age < BANDS[0][0] ? 0 : BANDS.length - 1;
  return { band: `${BANDS[i][0]}–${BANDS[i][1]}`, values: table[i], clamped };
}

/** VO2max at a percentile (5–95), interpolated between the listed ones. */
export function valueAtPercentile(values, pct) {
  const p = NORM_PERCENTILES;
  if (pct <= p[0]) return values[0];
  for (let i = 1; i < p.length; i++) {
    if (pct <= p[i]) return values[i - 1] + ((values[i] - values[i - 1]) * (pct - p[i - 1])) / (p[i] - p[i - 1]);
  }
  return values[values.length - 1];
}

/** Percentile of a VO2max, interpolated; below the 5th or above the 95th is clamped there. */
export function percentileOf(values, vo2) {
  const p = NORM_PERCENTILES;
  if (vo2 <= values[0]) return p[0];
  for (let i = 1; i < values.length; i++) {
    if (vo2 <= values[i]) return p[i - 1] + ((p[i] - p[i - 1]) * (vo2 - values[i - 1])) / (values[i] - values[i - 1]);
  }
  return p[p.length - 1];
}

/**
 * Category boundaries in ml/kg/min for a norms table: `min` is null for the lowest category
 * and `max` null for the highest.
 * @returns {{label:string, min:number|null, max:number|null}[]}
 */
export function categoryRanges(values) {
  return VO2_CATEGORIES.map((c, i) => ({
    label: c.label,
    min: i === 0 ? null : valueAtPercentile(values, c.from),
    max: i === VO2_CATEGORIES.length - 1 ? null : valueAtPercentile(values, c.to),
  }));
}

/**
 * Rate an estimate against the norms for its sex and age.
 * @returns {{band:string, clamped:boolean, percentile:number, below:boolean, above:boolean, category:number, ranges:ReturnType<typeof categoryRanges>} | null}
 *   `category` indexes VO2_CATEGORIES; `below`/`above` when outside the 5th–95th percentiles
 */
export function rateVo2max(vo2, sex, age) {
  const n = normsFor(sex, age);
  if (!n) return null;
  const ranges = categoryRanges(n.values);
  const valid = Number.isFinite(vo2);
  const percentile = valid ? percentileOf(n.values, vo2) : null;
  const category = valid ? ranges.findIndex((r) => r.max == null || vo2 < r.max) : -1;
  return {
    band: n.band,
    clamped: n.clamped,
    percentile,
    below: valid && vo2 < n.values[0],
    above: valid && vo2 > n.values[n.values.length - 1],
    category,
    ranges,
  };
}

/** "83rd" */
export function ordinal(n) {
  const r = Math.round(n);
  const t = r % 100;
  const s = t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][r % 10] ?? 'th';
  return `${r}${s}`;
}

const num = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '');

/** Text that is a plain number, such as "-12.3" from toFixed: safe to leave as it is. */
const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/**
 * One CSV field, quoted when it holds a comma, quote or line break. Text starting with =, +,
 * -, @, tab or CR gets a leading apostrophe so a spreadsheet shows it rather than running it
 * as a formula (a workout named "=HYPERLINK(…)" would otherwise become a live link); numbers,
 * including negative ones written as text, are left alone.
 */
export function csvCell(v) {
  if (v == null) return '';
  let s = String(v);
  if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(s) && !NUMERIC.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** One row per track point, SI units. */
export function toCSV(workout, track) {
  const rows = ['time_iso,elapsed_s,segment,latitude,longitude,altitude_m,distance_m,speed_mps,course_deg,h_accuracy_m,moving,hr_bpm'];
  for (let i = 0; i < track.n; i++) {
    rows.push(
      [
        new Date(track.t[i]).toISOString(),
        track.active[i].toFixed(1),
        track.seg[i],
        track.lat[i].toFixed(7),
        track.lon[i].toFixed(7),
        num(track.alt[i], 1),
        track.dist[i].toFixed(1),
        num(track.speed[i], 2),
        num(track.course[i], 1),
        num(track.acc[i], 1),
        track.moving[i],
        track.hr ? num(track.hr[i], 0) : '',
      ].join(',')
    );
  }
  return rows.join('\n') + '\n';
}

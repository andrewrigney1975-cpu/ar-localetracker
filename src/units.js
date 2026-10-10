// Unit conversion and display formatting. All internal values are SI (m, s, m/s).

export const M_PER_MI = 1609.344;
export const FT_PER_M = 3.28084;

export function splitLength(units) {
  return units === 'imperial' ? M_PER_MI : 1000;
}

export function distanceUnit(units) {
  return units === 'imperial' ? 'mi' : 'km';
}

export function distanceValue(m, units) {
  return units === 'imperial' ? m / M_PER_MI : m / 1000;
}

export function formatDistance(m, units, decimals = 2) {
  if (m == null || !Number.isFinite(m)) return '–';
  return `${distanceValue(m, units).toFixed(decimals)} ${distanceUnit(units)}`;
}

export function speedUnit(units) {
  return units === 'imperial' ? 'mph' : 'km/h';
}

export function speedValue(mps, units) {
  return units === 'imperial' ? (mps * 3600) / M_PER_MI : mps * 3.6;
}

export function formatSpeed(mps, units, withUnit = true) {
  if (mps == null || !Number.isFinite(mps)) return '–';
  const v = speedValue(mps, units).toFixed(1);
  return withUnit ? `${v} ${speedUnit(units)}` : v;
}

export function paceUnit(units) {
  return units === 'imperial' ? '/mi' : '/km';
}

/** Seconds per km (or mile) for a speed in m/s. */
export function paceSeconds(mps, units) {
  if (!mps || mps <= 0.05 || !Number.isFinite(mps)) return null;
  return splitLength(units) / mps;
}

export function formatPace(mps, units, withUnit = true) {
  const s = paceSeconds(mps, units);
  if (s == null || s > 5999) return withUnit ? `–:–– ${paceUnit(units)}` : '–:––';
  const txt = `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`.replace(/:60$/, ':59');
  return withUnit ? `${txt} ${paceUnit(units)}` : txt;
}

export function altitudeUnit(units) {
  return units === 'imperial' ? 'ft' : 'm';
}

export function altitudeValue(m, units) {
  return units === 'imperial' ? m * FT_PER_M : m;
}

export function formatAltitude(m, units, withUnit = true) {
  if (m == null || !Number.isFinite(m)) return '–';
  const v = Math.round(altitudeValue(m, units)).toLocaleString();
  return withUnit ? `${v} ${altitudeUnit(units)}` : v;
}

export function formatDuration(seconds) {
  if (seconds == null || !Number.isFinite(seconds)) return '–';
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatCoord(value, axis) {
  if (value == null || !Number.isFinite(value)) return '–';
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  return `${Math.abs(value).toFixed(5)}° ${hemi}`;
}

/** Degrees, minutes, seconds, e.g. 33°52'23.2" S. */
export function formatDMS(value, axis) {
  if (value == null || !Number.isFinite(value)) return '–';
  const hemi = axis === 'lat' ? (value >= 0 ? 'N' : 'S') : value >= 0 ? 'E' : 'W';
  // Round to 0.1" first so 59.96" carries into the next minute.
  let tenths = Math.round(Math.abs(value) * 36000);
  const deg = Math.floor(tenths / 36000);
  tenths -= deg * 36000;
  const min = Math.floor(tenths / 600);
  const sec = (tenths - min * 600) / 10;
  return `${deg}°${String(min).padStart(2, '0')}'${sec.toFixed(1).padStart(4, '0')}" ${hemi}`;
}

const CARDINALS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

export function headingCardinal(deg) {
  if (deg == null || !Number.isFinite(deg)) return '–';
  return CARDINALS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

export function formatClock(epochMs) {
  return new Date(epochMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function formatDate(epochMs) {
  return new Date(epochMs).toLocaleDateString([], { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

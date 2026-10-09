// Geodesy helpers. Distances in metres, angles in degrees unless noted.

export const EARTH_RADIUS = 6371008.8;
const RAD = Math.PI / 180;

export function haversine(lat1, lon1, lat2, lon2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function bearing(lat1, lon1, lat2, lon2) {
  const y = Math.sin((lon2 - lon1) * RAD) * Math.cos(lat2 * RAD);
  const x =
    Math.cos(lat1 * RAD) * Math.sin(lat2 * RAD) - Math.sin(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.cos((lon2 - lon1) * RAD);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** Destination point given start, bearing (deg) and distance (m). */
export function destination(lat, lon, brg, dist) {
  const d = dist / EARTH_RADIUS;
  const b = brg * RAD;
  const p1 = lat * RAD;
  const l1 = lon * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / RAD, (((l2 / RAD) + 540) % 360) - 180];
}

/**
 * Local tangent-plane (equirectangular) projection around an origin.
 * Accurate to well under 0.1% over the extent of a single workout.
 */
export function makeProjection(lat0, lon0) {
  const kx = Math.cos(lat0 * RAD) * EARTH_RADIUS * RAD;
  const ky = EARTH_RADIUS * RAD;
  return {
    lat0,
    lon0,
    toXY: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
    toLatLon: (x, y) => [lat0 + y / ky, lon0 + x / kx],
  };
}

export function bbox(lat, lon, n = lat.length) {
  let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
  for (let i = 0; i < n; i++) {
    if (lon[i] < w) w = lon[i];
    if (lon[i] > e) e = lon[i];
    if (lat[i] < s) s = lat[i];
    if (lat[i] > nn) nn = lat[i];
  }
  return [w, s, e, nn];
}

/** Douglas–Peucker simplification on projected points; returns kept indices. */
export function simplifyIndices(xs, ys, tolerance) {
  const n = xs.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [a, b] = stack.pop();
    let maxD = 0;
    let idx = -1;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const len2 = dx * dx + dy * dy;
    for (let i = a + 1; i < b; i++) {
      let t = len2 > 0 ? ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const px = xs[a] + t * dx - xs[i];
      const py = ys[a] + t * dy - ys[i];
      const d = px * px + py * py;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tol2 && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(i);
  return out;
}

/** Index of the last element in a sorted numeric array that is <= value. */
export function lowerIndex(arr, value, n = arr.length) {
  let lo = 0;
  let hi = n - 1;
  if (value <= arr[0]) return 0;
  if (value >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= value) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function median(values) {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

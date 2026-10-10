// Display-only smoothing for the 3D view (backlog item 5). Stats, splits, exports and the
// stored track are never touched; this only changes how the 3D route is drawn.

export const SMOOTH_WINDOW_S = 10;

/**
 * Time-weighted moving average over a centred window (default 10 s: ±5 s).
 *
 * Each value is the integral of the linearly interpolated signal over the window divided by
 * the window length, so uneven fix spacing (bursts of sub-second fixes, gaps) does not cause
 * the step-wise zig-zag a plain sample average would. Computed per segment so a manual
 * pause is never averaged across; at segment ends the window is clipped to the data.
 * Non-finite values (e.g. missing altitude) are filled by linear interpolation first.
 *
 * @param {{n:number, t:Float64Array, seg:Uint16Array}} track  t in epoch ms
 * @param {Record<string, ArrayLike<number>>} columns  e.g. {x, y, alt, speed}
 * @param {number} [windowS]
 * @returns {Record<string, Float64Array>} smoothed columns, same keys
 */
export function smoothForDisplay(track, columns, windowS = SMOOTH_WINDOW_S) {
  const { n, t, seg } = track;
  const half = (windowS * 1000) / 2;
  const out = {};
  for (const [key, src] of Object.entries(columns)) {
    const res = new Float64Array(n);
    let start = 0;
    while (start < n) {
      let end = start;
      while (end < n && seg[end] === seg[start]) end++;
      smoothSegment(t, src, start, end, half, res);
      start = end;
    }
    out[key] = res;
  }
  return out;
}

function smoothSegment(t, src, start, end, half, res) {
  const m = end - start;
  const f = fillGaps(src, start, end);
  if (!f) {
    for (let i = start; i < end; i++) res[i] = src[i]; // no finite values at all
    return;
  }
  if (m === 1 || t[end - 1] === t[start]) {
    for (let i = 0; i < m; i++) res[start + i] = f[i];
    return;
  }
  // Prefix integral of the piecewise-linear signal (trapezoids), in value·ms.
  const I = new Float64Array(m);
  for (let k = 1; k < m; k++) I[k] = I[k - 1] + ((f[k] + f[k - 1]) / 2) * (t[start + k] - t[start + k - 1]);

  // Integral from the segment start up to time tau (clamped to the segment).
  let cursor = 0;
  const F = (tau, hint) => {
    let k = hint;
    while (k < m - 1 && t[start + k + 1] <= tau) k++;
    while (k > 0 && t[start + k] > tau) k--;
    cursor = k;
    if (k >= m - 1) return I[m - 1];
    const t0 = t[start + k];
    const t1 = t[start + k + 1];
    const v = t1 > t0 ? f[k] + ((f[k + 1] - f[k]) * (tau - t0)) / (t1 - t0) : f[k];
    return I[k] + ((f[k] + v) / 2) * (tau - t0);
  };

  const tFirst = t[start];
  const tLast = t[end - 1];
  let loHint = 0;
  let hiHint = 0;
  for (let i = 0; i < m; i++) {
    const ti = t[start + i];
    const a = Math.max(tFirst, ti - half);
    const b = Math.min(tLast, ti + half);
    if (b <= a) {
      res[start + i] = f[i];
      continue;
    }
    const Fb = F(b, hiHint);
    hiHint = cursor;
    const Fa = F(a, loHint);
    loHint = cursor;
    res[start + i] = (Fb - Fa) / (b - a);
  }
}

/** Copy of src[start:end) with non-finite values linearly interpolated (edges held). */
function fillGaps(src, start, end) {
  const m = end - start;
  const f = new Float64Array(m);
  let prev = -1;
  for (let i = 0; i < m; i++) {
    const v = src[start + i];
    if (!Number.isFinite(v)) continue;
    f[i] = v;
    if (prev === -1) for (let k = 0; k < i; k++) f[k] = v;
    else for (let k = prev + 1; k < i; k++) f[k] = f[prev] + ((v - f[prev]) * (k - prev)) / (i - prev);
    prev = i;
  }
  if (prev === -1) return null;
  for (let k = prev + 1; k < m; k++) f[k] = f[prev];
  return f;
}

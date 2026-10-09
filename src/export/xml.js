export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export const iso = (ms) => new Date(Math.round(ms)).toISOString();

export const fixed = (v, d) => (Number.isFinite(v) ? Number(v).toFixed(d) : null);

/** Index ranges [from, to) of contiguous segments. */
export function segmentRanges(track) {
  const ranges = [];
  let s = 0;
  for (let i = 1; i <= track.n; i++) {
    if (i === track.n || track.seg[i] !== track.seg[s]) {
      ranges.push([s, i]);
      s = i;
    }
  }
  return ranges;
}

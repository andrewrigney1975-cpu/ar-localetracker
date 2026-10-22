// Significant high and low points of an altitude profile, for labelling the workout's
// elevation chart. Pure, so it is unit-tested.

/**
 * Peaks and troughs that stand out by at least `minSwing` metres from the ground on both
 * sides (a zig-zag filter: a turning point counts once the profile has moved `minSwing` back
 * from it), plus the highest and lowest points. When there are more than `max`, the ones
 * with the biggest swings are kept, with the highest and lowest always among them.
 *
 * @param {ArrayLike<number>} dist cumulative distance (m)
 * @param {ArrayLike<number>} alt altitude (m), may contain NaN
 * @param {number} n number of points
 * @param {{minSwing?: number, minFraction?: number, max?: number}} [opts] the swing needed is
 *   the larger of `minSwing` and `minFraction` of the climb range
 * @returns {{i: number, type: 'high'|'low', alt: number, dist: number, swing: number}[]} by distance
 */
export function significantExtremes(dist, alt, n, { minSwing = 5, minFraction = 0.2, max = 6 } = {}) {
  let hiI = -1;
  let loI = -1;
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(alt[i])) continue;
    if (hiI < 0 || alt[i] > alt[hiI]) hiI = i;
    if (loI < 0 || alt[i] < alt[loI]) loI = i;
  }
  if (hiI < 0) return [];
  const range = alt[hiI] - alt[loI];
  if (range < minSwing) return [];
  const need = Math.max(minSwing, range * minFraction);

  // Zig-zag: follow the current run up or down; when the profile turns back by `need`, the
  // run's end is a turning point.
  const turns = [];
  let dir = 0; // 1 rising, -1 falling, 0 not yet known
  let cand = -1;
  let first = -1;
  let minI = -1;
  let maxI = -1;
  for (let i = 0; i < n; i++) {
    const a = alt[i];
    if (!Number.isFinite(a)) continue;
    if (cand < 0) {
      cand = first = minI = maxI = i;
      continue;
    }
    if (dir === 0) {
      // Until the first big move, watch the lowest and highest so far: a climb of `need`
      // from the lowest makes that low a turning point (unless it's the start), and so on.
      if (a < alt[minI]) minI = i;
      if (a > alt[maxI]) maxI = i;
      if (a - alt[minI] >= need) {
        if (minI !== first) turns.push({ i: minI, type: 'low' });
        dir = 1;
        cand = i;
      } else if (alt[maxI] - a >= need) {
        if (maxI !== first) turns.push({ i: maxI, type: 'high' });
        dir = -1;
        cand = i;
      }
      continue;
    }
    if (dir === 1) {
      if (a > alt[cand]) cand = i;
      else if (alt[cand] - a >= need) {
        turns.push({ i: cand, type: 'high' });
        dir = -1;
        cand = i;
      }
    } else if (a < alt[cand]) cand = i;
    else if (a - alt[cand] >= need) {
      turns.push({ i: cand, type: 'low' });
      dir = 1;
      cand = i;
    }
  }

  // The swing of a turning point: the smaller drop (or rise) to its neighbouring turns, or to
  // the ends of the profile.
  const ends = [first, cand];
  const swingOf = (k) => {
    const t = turns[k];
    const prev = k > 0 ? turns[k - 1].i : ends[0];
    const next = k < turns.length - 1 ? turns[k + 1].i : ends[1];
    return Math.min(Math.abs(alt[t.i] - alt[prev]), Math.abs(alt[t.i] - alt[next]));
  };
  let out = turns.map((t, k) => ({ ...t, swing: swingOf(k) }));
  // The highest and lowest points are always labelled, even at the start or finish.
  for (const [i, type] of [
    [hiI, 'high'],
    [loI, 'low'],
  ]) {
    if (!out.some((t) => t.i === i)) out.push({ i, type, swing: range });
    else out.find((t) => t.i === i).swing = range;
  }
  out.sort((a, b) => b.swing - a.swing);
  out = out.slice(0, max);
  return out.sort((a, b) => a.i - b.i).map((t) => ({ ...t, alt: alt[t.i], dist: dist[t.i] }));
}

// Nearest-point-on-track queries for dragging a marker along the route.

import { makeProjection } from './geo.js';

export class TrackSnapper {
  constructor(track) {
    this.track = track;
    const n = track.n;
    this.proj = makeProjection(n ? track.lat[0] : 0, n ? track.lon[0] : 0);
    this.xs = new Float64Array(n);
    this.ys = new Float64Array(n);
    for (let i = 0; i < n; i++) [this.xs[i], this.ys[i]] = this.proj.toXY(track.lat[i], track.lon[i]);
  }

  /**
   * Closest point on the polyline to (lat, lon). Segments spanning a pause are skipped.
   * Brute force is fine: ~10k segments is well under 1 ms per query.
   * @returns {{i:number, f:number, dist:number, meters:number}|null}
   */
  nearest(lat, lon) {
    const { n, seg, dist } = this.track;
    if (n === 0) return null;
    const [px, py] = this.proj.toXY(lat, lon);
    const { xs, ys } = this;
    let best = { i: 0, f: 0, d2: (xs[0] - px) ** 2 + (ys[0] - py) ** 2 };
    for (let i = 0; i < n - 1; i++) {
      if (seg[i] !== seg[i + 1]) continue;
      const dx = xs[i + 1] - xs[i];
      const dy = ys[i + 1] - ys[i];
      const len2 = dx * dx + dy * dy;
      let f = len2 > 0 ? ((px - xs[i]) * dx + (py - ys[i]) * dy) / len2 : 0;
      f = f < 0 ? 0 : f > 1 ? 1 : f;
      const cx = xs[i] + f * dx - px;
      const cy = ys[i] + f * dy - py;
      const d2 = cx * cx + cy * cy;
      if (d2 < best.d2) best = { i, f, d2 };
    }
    const j = Math.min(n - 1, best.i + 1);
    return {
      i: best.i,
      f: best.f,
      dist: dist[best.i] + (dist[j] - dist[best.i]) * best.f,
      meters: Math.sqrt(best.d2),
    };
  }
}

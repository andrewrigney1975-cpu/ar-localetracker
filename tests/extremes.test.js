import { describe, expect, it } from 'vitest';
import { significantExtremes } from '../src/stats/extremes.js';

/** A profile from [distance m, altitude m] corners, sampled every 10 m. */
function profile(corners) {
  const dist = [];
  const alt = [];
  for (let k = 0; k < corners.length - 1; k++) {
    const [d0, a0] = corners[k];
    const [d1, a1] = corners[k + 1];
    for (let d = d0; d < d1; d += 10) {
      dist.push(d);
      alt.push(a0 + ((a1 - a0) * (d - d0)) / (d1 - d0));
    }
  }
  const [dl, al] = corners[corners.length - 1];
  dist.push(dl);
  alt.push(al);
  return { dist, alt, n: dist.length };
}

const summary = (r) => r.map((e) => `${e.type} ${Math.round(e.alt)}@${e.dist}`);

describe('significant highs and lows', () => {
  it('finds the hill and the valley of a two-hump route, with the highest and lowest points', () => {
    const p = profile([
      [0, 20],
      [1000, 80],
      [2000, 30],
      [3000, 60],
      [4000, 10],
    ]);
    expect(summary(significantExtremes(p.dist, p.alt, p.n))).toEqual(['high 80@1000', 'low 30@2000', 'high 60@3000', 'low 10@4000']);
  });

  it('ignores bumps smaller than a fifth of the range', () => {
    const p = profile([
      [0, 0],
      [1000, 100],
      [1100, 92], // an 8 m dip on a 100 m climb
      [1200, 100],
      [2000, 0],
    ]);
    expect(summary(significantExtremes(p.dist, p.alt, p.n))).toEqual(['low 0@0', 'high 100@1000']);
  });

  it('labels nothing on a flat route', () => {
    const p = profile([
      [0, 10],
      [500, 13],
      [1000, 10],
    ]);
    expect(significantExtremes(p.dist, p.alt, p.n)).toEqual([]);
  });

  it('keeps the biggest swings when there are too many, always with the highest and lowest', () => {
    const corners = [[0, 0]];
    for (let k = 1; k <= 12; k++) corners.push([k * 500, k % 2 ? 40 + k : 0]);
    corners.push([6500, 100]);
    const p = profile(corners);
    const r = significantExtremes(p.dist, p.alt, p.n, { max: 4 });
    expect(r).toHaveLength(4);
    expect(r.some((e) => e.type === 'high' && e.alt === 100)).toBe(true);
    expect(r.some((e) => e.type === 'low' && e.alt === 0)).toBe(true);
  });

  it('skips missing altitudes', () => {
    const p = profile([
      [0, 0],
      [1000, 50],
      [2000, 0],
    ]);
    p.alt[3] = NaN;
    expect(summary(significantExtremes(p.dist, p.alt, p.n))).toEqual(['low 0@0', 'high 50@1000']);
  });
});

describe('significant highs and lows before the first big move', () => {
  it('finds a dip before the first climb', () => {
    const p = profile([
      [0, 50],
      [500, 30],
      [1500, 100],
      [2500, 60],
    ]);
    expect(summary(significantExtremes(p.dist, p.alt, p.n))).toEqual(['low 30@500', 'high 100@1500']);
  });
});

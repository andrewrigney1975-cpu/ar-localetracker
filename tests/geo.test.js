import { describe, expect, it } from 'vitest';
import { bearing, destination, haversine, lowerIndex, makeProjection, simplifyIndices } from '../src/geo/geo.js';
import { smoothAxis } from '../src/geo/kalman.js';
import { mulberry32 } from '../src/tracker/synthetic.js';
import { formatDuration, formatPace, headingCardinal, formatDistance, formatAltitude } from '../src/units.js';

describe('geo', () => {
  it('haversine matches a known distance', () => {
    // London → Paris ≈ 343.5 km
    expect(haversine(51.5074, -0.1278, 48.8566, 2.3522) / 1000).toBeCloseTo(343.5, 0);
  });

  it('destination and bearing round-trip', () => {
    const [lat, lon] = destination(45, 7, 63, 1500);
    expect(haversine(45, 7, lat, lon)).toBeCloseTo(1500, 3);
    expect(bearing(45, 7, lat, lon)).toBeCloseTo(63, 1);
  });

  it('projection is accurate locally', () => {
    const p = makeProjection(50, -122);
    const [lat, lon] = destination(50, -122, 120, 2000);
    const [x, y] = p.toXY(lat, lon);
    expect(Math.hypot(x, y)).toBeCloseTo(2000, -1);
    const [lat2, lon2] = p.toLatLon(x, y);
    expect(lat2).toBeCloseTo(lat, 9);
    expect(lon2).toBeCloseTo(lon, 9);
  });

  it('Douglas–Peucker keeps endpoints and corners', () => {
    const xs = [0, 1, 2, 3, 3, 3];
    const ys = [0, 0, 0, 0, 1, 2];
    expect(simplifyIndices(xs, ys, 0.1)).toEqual([0, 3, 5]);
  });

  it('lowerIndex finds the bracketing index', () => {
    const a = [0, 10, 20, 30];
    expect(lowerIndex(a, -1)).toBe(0);
    expect(lowerIndex(a, 15)).toBe(1);
    expect(lowerIndex(a, 30)).toBe(3);
  });
});

describe('kalman', () => {
  it('reduces noise on a constant-velocity track', () => {
    const rand = mulberry32(1);
    const n = 300;
    const t = new Float64Array(n);
    const truth = new Float64Array(n);
    const z = new Float64Array(n);
    const r = new Float64Array(n).fill(5);
    for (let i = 0; i < n; i++) {
      t[i] = i;
      truth[i] = 3 * i;
      z[i] = truth[i] + (rand() - 0.5) * 2 * 8;
    }
    const s = smoothAxis(t, z, r, 0.5);
    const rms = (a) => Math.sqrt(a.reduce((acc, v, i) => acc + (v - truth[i]) ** 2, 0) / n);
    expect(rms(s)).toBeLessThan(rms(z) * 0.5);
  });
});

describe('units', () => {
  it('formats durations', () => {
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
  it('formats pace and distance in both systems', () => {
    expect(formatPace(1000 / 300, 'metric')).toBe('5:00 /km');
    expect(formatPace(1609.344 / 480, 'imperial')).toBe('8:00 /mi');
    expect(formatDistance(1609.344, 'imperial')).toBe('1.00 mi');
    expect(formatAltitude(100, 'imperial')).toBe('328 ft');
  });
  it('maps headings to cardinals', () => {
    expect(headingCardinal(0)).toBe('N');
    expect(headingCardinal(359)).toBe('N');
    expect(headingCardinal(90)).toBe('E');
    expect(headingCardinal(200)).toBe('SSW');
  });
});

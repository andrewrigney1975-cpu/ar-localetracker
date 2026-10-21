import { describe, expect, it } from 'vitest';
import { categoryRanges, normsFor, ordinal, percentileOf, rateVo2max, valueAtPercentile } from '../src/stats/vo2norms.js';

describe('VO2max norms', () => {
  it('picks the age band, clamping outside 20–79', () => {
    expect(normsFor('male', 51)).toMatchObject({ band: '50–59', clamped: false, values: [20.9, 22.8, 27.1, 32.6, 39.7, 45.6, 50.7] });
    expect(normsFor('female', 18)).toMatchObject({ band: '20–29', clamped: true });
    expect(normsFor('female', 85)).toMatchObject({ band: '70–79', clamped: true });
    expect(normsFor(null, 40)).toBeNull();
  });

  it('interpolates between the listed percentiles', () => {
    const v = normsFor('male', 51).values;
    expect(valueAtPercentile(v, 50)).toBe(32.6);
    expect(valueAtPercentile(v, 20)).toBeCloseTo(22.8 + (4.3 * 10) / 15, 6);
    expect(percentileOf(v, 39.7)).toBe(75);
    expect(percentileOf(v, 42.9)).toBeCloseTo(75 + (15 * 3.2) / 5.9, 6);
    expect(percentileOf(v, 10)).toBe(5);
    expect(percentileOf(v, 70)).toBe(95);
  });

  it('gives seven categories on the ACSM boundaries', () => {
    const r = categoryRanges(normsFor('male', 51).values);
    expect(r.map((c) => c.label)).toEqual(['Very Poor', 'Poor', 'Fair', 'Average', 'Good', 'Very Good', 'Excellent']);
    expect(r[0]).toEqual({ label: 'Very Poor', min: null, max: 22.8 });
    expect(r[6]).toEqual({ label: 'Excellent', min: 50.7, max: null });
    for (let i = 1; i < r.length; i++) expect(r[i].min).toBe(r[i - 1].max);
  });

  it('rates an estimate', () => {
    expect(rateVo2max(42.9, 'male', 51)).toMatchObject({ band: '50–59', category: 5, below: false, above: false });
    expect(rateVo2max(42.9, 'male', 51).percentile).toBeCloseTo(83.1, 1);
    expect(rateVo2max(15, 'female', 55)).toMatchObject({ category: 0, below: true, percentile: 5 });
    expect(rateVo2max(60, 'male', 51)).toMatchObject({ category: 6, above: true });
    expect(rateVo2max(null, 'male', 51)).toMatchObject({ category: -1, percentile: null });
  });

  it('writes ordinals', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 83, 95].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '83rd', '95th']);
  });
});

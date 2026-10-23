import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { haversine } from '../src/geo/geo.js';
import { describe as stats, groupStats, gpsStatsCSV, rawDistance } from '../src/stats/gpsDistance.js';

const pt = (o) => JSON.stringify({ type: 'pt', seg: 0, ...o });

describe('raw GPS distance from a journal', () => {
  it('adds straight lines between fixes in the same segment, gating by reported accuracy', () => {
    const text = [
      JSON.stringify({ type: 'meta', v: 1 }),
      pt({ lat: -35, lon: 147, ha: 5, sv: 20 }),
      pt({ lat: -35.001, lon: 147, ha: 30, sv: 10 }), // poor fix: raw only
      pt({ lat: -35.002, lon: 147, ha: 6, sv: 18 }),
      pt({ lat: -35.003, lon: 147, ha: 4, sv: 22, seg: 1 }), // new segment: no line across the gap
      pt({ lat: -35.004, lon: 147, ha: 4, sv: 22, seg: 1 }),
      '{"type":"pt","lat":-35.0', // torn last line
    ].join('\n');
    const step = haversine(-35, 147, -35.001, 147);
    const r = rawDistance(text);
    expect(r.points).toBe(5);
    expect(r.raw).toBeCloseTo(3 * step, 6);
    expect(r.gated).toBeCloseTo(3 * step, 6); // 0→2 skips the poor fix, then 3→4
    expect(r.accuracy).toBeCloseTo(49 / 5, 9);
    expect(r.satellites).toBeCloseTo(92 / 5, 9);
  });

  it('reads longer than the saved distance on a real recording', () => {
    const text = readFileSync(new URL('../android/app/src/test/resources/fixtures/city2surf.ndjson', import.meta.url), 'utf8');
    const expected = JSON.parse(readFileSync(new URL('../android/app/src/test/resources/fixtures/city2surf.expected.json', import.meta.url), 'utf8'));
    const r = rawDistance(text);
    expect(r.raw).toBeGreaterThan(expected.summary.distance);
    expect(r.gated).toBeLessThanOrEqual(r.raw);
  });

  it('returns null without fixes', () => {
    expect(rawDistance('{"type":"meta"}\n')).toBeNull();
  });
});

describe('distance statistics', () => {
  it('gives n, min, max, mean, sample SD and CV', () => {
    const s = stats([14540.3, 14944.5, 14672.7]);
    expect(s.n).toBe(3);
    expect(s.min).toBe(14540.3);
    expect(s.max).toBe(14944.5);
    expect(s.mean).toBeCloseTo(14719.1667, 3);
    expect(s.sd).toBeCloseTo(206.07, 2);
    expect(s.cv).toBeCloseTo((s.sd / s.mean) * 100, 9);
    expect(stats([5]).sd).toBeNull();
    expect(stats([]).n).toBe(0);
  });

  it('summarises each routine, then the raw excess over all of them', () => {
    const rows = [
      { group: 'Lake Loop', raw: 15100, gated: 15000, smoothed: 14700 },
      { group: 'Lake Loop', raw: 14900, gated: 14800, smoothed: 14600 },
      { group: 'CSU Loop', raw: 4900, gated: 4850, smoothed: 4800 },
    ];
    const g = groupStats(rows);
    expect(g.map((s) => `${s.group}: ${s.series}`)).toEqual([
      'Lake Loop: Raw GPS',
      'Lake Loop: Raw GPS, fixes ≤ ±20 m',
      'Lake Loop: Smoothed (saved)',
      'Lake Loop: Raw over smoothed',
      'CSU Loop: Raw GPS',
      'CSU Loop: Raw GPS, fixes ≤ ±20 m',
      'CSU Loop: Smoothed (saved)',
      'CSU Loop: Raw over smoothed',
      'All workouts: Raw over smoothed',
    ]);
    expect(g[0]).toMatchObject({ n: 2, min: 14900, max: 15100, mean: 15000 });
    expect(g[8].n).toBe(3);
    expect(groupStats(rows.slice(0, 2))).toHaveLength(4);
  });
});

describe('GPS distance CSV', () => {
  it('writes the statistics, a blank line, then one row per workout in date order', () => {
    const rows = [
      { startedAt: 2000, name: 'Lake Loop, 2 laps', activity: 'walk', group: 'Lake Loop', raw: 15100, gated: 15000, smoothed: 14700, accuracy: 8.04, satellites: 19.5, points: 8800, weather: { condition: 'Clear', tempC: 11.26, windMs: 3 } },
      { startedAt: 1000, name: 'Lake Loop', activity: 'walk', group: 'Lake Loop', raw: 14900, gated: 14800, smoothed: 14600, accuracy: null, satellites: null, points: 9000, weather: { unavailable: true } },
    ];
    const csv = gpsStatsCSV(rows, { localTime: (ms) => [`day${ms}`, '04:00'] }).split('\n');
    expect(csv[0]).toBe('group,series,unit,n,min,max,mean,sd,cv_pct');
    expect(csv[1]).toBe('Lake Loop,Raw GPS,m,2,14900.0,15100.0,15000.0,141.4,0.94');
    expect(csv[4]).toBe('Lake Loop,Raw over smoothed,%,2,2.05,2.72,2.39,0.47,19.73');
    expect(csv[5]).toBe('');
    expect(csv[6].startsWith('date,start,name,activity,group,raw_m,')).toBe(true);
    expect(csv[7]).toBe('day1000,04:00,Lake Loop,walk,Lake Loop,14900.0,14800.0,14600.0,300.0,2.05,,,9000,,,');
    expect(csv[8]).toBe('day2000,04:00,"Lake Loop, 2 laps",walk,Lake Loop,15100.0,15000.0,14700.0,400.0,2.72,8.0,19.5,8800,Clear,11.3,11');
  });

  it('keeps formula-like names inert but negative numbers as numbers', () => {
    const rows = [{ startedAt: 1, name: '=HYPERLINK("http://x","y")', activity: 'walk', group: '+Loop', raw: 1000, gated: 990, smoothed: 1012.3, accuracy: 5, satellites: 20, points: 300 }];
    const line = gpsStatsCSV(rows, { localTime: () => ['d', 't'] }).split('\n')[7];
    expect(line).toBe(`d,t,"'=HYPERLINK(""http://x"",""y"")",walk,'+Loop,1000.0,990.0,1012.3,-12.3,-1.22,5.0,20.0,300,,,`);
  });
});

describe('CSV cells', () => {
  it('quotes, neutralises formulas and leaves numbers alone', async () => {
    const { csvCell } = await import('../src/export/csv.js');
    expect(csvCell(null)).toBe('');
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\rbreak')).toBe('"line\rbreak"');
    for (const s of ['=1+1', '+SUM(A1)', '-cmd', '@x', '\tx']) expect(csvCell(s)).toBe(`'${s}`);
    expect(csvCell('\r=1')).toBe(`"'\r=1"`);
    for (const v of [-12.3, '-12.3', '+5', '-0.5', '1e-3', '-.5']) expect(csvCell(v)).toBe(String(v));
    expect(csvCell('-12.3 km')).toBe("'-12.3 km");
  });
});

import { describe, expect, it } from 'vitest';
import { alignCadence, processJournal } from '../src/geo/process.js';
import { cadenceStats } from '../src/stats/summary.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

describe('step cadence', () => {
  it('parses cadence lines from the watch and the phone', () => {
    const j = parseJournal(
      [
        '{"type":"cad","t":3000,"spm":120,"src":"phone"}',
        '{"type":"cad","t":1000,"spm":118}',
        '{"type":"cad","t":2000,"spm":300,"src":"watch"}',
        '{"type":"cad","t":2500,"spm":0,"src":"watch"}',
      ].join('\n')
    );
    expect(j.cad).toEqual([
      { t: 1000, spm: 118, src: 'watch' },
      { t: 2500, spm: 0, src: 'watch' },
      { t: 3000, spm: 120, src: 'phone' },
    ]);
  });

  it("uses the watch's cadence, and the phone's in the watch's gaps", () => {
    const times = [0, 2000, 4000, 30000, 32000, 60000];
    const { cad, cadSrc } = alignCadence(times, [
      { t: 0, spm: 110, src: 'watch' },
      { t: 4000, spm: 114, src: 'watch' },
      { t: 30000, spm: 120, src: 'phone' },
      { t: 32000, spm: 122, src: 'phone' },
    ]);
    expect(Array.from(cad.slice(0, 5))).toEqual([110, 112, 114, 120, 122]);
    expect(Number.isNaN(cad[5])).toBe(true);
    expect(Array.from(cadSrc)).toEqual([1, 1, 1, 2, 2, 0]);
  });

  it('keeps the cadence on the track and averages it over moving time', () => {
    const watch = processJournal(parseJournal(generateJournal({ activity: 'walk', seconds: 900, seed: 3, cadence: 'watch', stops: false }).text)).track;
    expect(cadenceStats(watch)).toMatchObject({ source: 'watch' });
    expect(cadenceStats(watch).avg).toBeGreaterThan(100);
    expect(cadenceStats(watch).avg).toBeLessThan(140);
    const both = processJournal(parseJournal(generateJournal({ activity: 'walk', seconds: 900, seed: 3, cadence: 'both', stops: false }).text)).track;
    expect(cadenceStats(both).source).toBe('mixed');
    expect(Array.from(both.cadSrc).filter((s) => s === 2).length).toBeGreaterThan(80); // the 2-minute watch gap (kept fixes)
    const phone = processJournal(parseJournal(generateJournal({ activity: 'walk', seconds: 900, seed: 3, cadence: 'phone', stops: false }).text)).track;
    expect(cadenceStats(phone).source).toBe('phone');
    expect(processJournal(parseJournal(generateJournal({ activity: 'cycle', seconds: 300, seed: 3, cadence: 'both' }).text)).track.cad).toBeUndefined();
  });

  it('leaves standing still out of the average', () => {
    const t = { n: 4, t: [0, 1000, 2000, 3000], seg: [0, 0, 0, 0], moving: [1, 1, 0, 1], cad: [100, 100, 0, 120], cadSrc: [1, 1, 1, 1] };
    expect(cadenceStats(t)).toEqual({ avg: 110, source: 'watch' });
    expect(cadenceStats({ ...t, cad: undefined })).toBeNull();
  });
});

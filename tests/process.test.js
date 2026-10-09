import { describe, expect, it } from 'vitest';
import { processJournal, sampleAtDistance } from '../src/geo/process.js';
import { activeIntervals, parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

describe('journal parsing', () => {
  it('tolerates a torn final line', () => {
    const { text } = generateJournal({ seconds: 60 });
    const torn = text + '{"type":"pt","s":999,"t":12';
    const j = parseJournal(torn);
    expect(j.meta.activity).toBe('run');
    expect(j.points.length).toBe(60);
    expect(j.end).not.toBeNull();
  });

  it('derives active intervals excluding manual pauses', () => {
    const states = [
      { t: 0, state: 'recording' },
      { t: 100, state: 'autopaused' },
      { t: 150, state: 'recording' },
      { t: 200, state: 'paused' },
      { t: 500, state: 'recording' },
      { t: 600, state: 'idle' },
    ];
    expect(activeIntervals(states, 600)).toEqual([[0, 200], [500, 600]]);
  });
});

describe('processJournal', () => {
  for (const activity of ['walk', 'run', 'cycle']) {
    it(`measures ${activity} distance within 3% of truth`, () => {
      const { text, trueDistance } = generateJournal({ activity, seconds: 1800, seed: 11 });
      const { track } = processJournal(parseJournal(text));
      const d = track.dist[track.n - 1];
      expect(Math.abs(d - trueDistance) / trueDistance).toBeLessThan(0.03);
    });
  }

  it('splits segments on manual pause and excludes pause time', () => {
    const { text } = generateJournal({ seconds: 600, pauses: [[300, 120]] });
    const { track, info } = processJournal(parseJournal(text));
    expect(track.seg[0]).toBe(0);
    expect(track.seg[track.n - 1]).toBe(1);
    expect(info.activeSeconds).toBeCloseTo(600, -1);
    expect(track.active[track.n - 1]).toBeLessThan(605);
  });

  it('rejects a single wild position spike', () => {
    const { text } = generateJournal({ seconds: 300, stops: false });
    const j = parseJournal(text);
    const spike = { ...j.points[150], lat: j.points[150].lat + 0.05 };
    j.points[150] = spike;
    const { track } = processJournal(j);
    const clean = processJournal(parseJournal(text)).track;
    expect(Math.abs(track.dist[track.n - 1] - clean.dist[clean.n - 1])).toBeLessThan(60);
  });

  it('interpolates samples by distance', () => {
    const { text } = generateJournal({ seconds: 600 });
    const { track } = processJournal(parseJournal(text));
    const mid = track.dist[track.n - 1] / 2;
    const s = sampleAtDistance(track, mid);
    expect(s.dist).toBeCloseTo(mid, 3);
    expect(Number.isFinite(s.alt)).toBe(true);
  });

  it('handles an empty journal', () => {
    const { track } = processJournal(parseJournal(''), 'run');
    expect(track.n).toBe(0);
  });
});

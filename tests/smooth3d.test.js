import { describe, expect, it } from 'vitest';
import { smoothForDisplay } from '../src/view3d/smooth.js';

/** Track helper: times in ms (1 Hz by default) and segment ids. */
function track(n, { seg = () => 0, time = (i) => i * 1000 } = {}) {
  const t = new Float64Array(n);
  const s = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    t[i] = time(i);
    s[i] = seg(i);
  }
  return { n, t, seg: s };
}

const zigzag = (a) => {
  let total = 0;
  for (let i = 1; i < a.length - 1; i++) total += Math.abs(a[i + 1] - 2 * a[i] + a[i - 1]);
  return total / (a.length - 2);
};

describe('3D display smoothing (10 s time-weighted average)', () => {
  it('spreads a 1-sample spike over the 10 s window by area', () => {
    const tr = track(30);
    const alt = Float64Array.from({ length: 30 }, (_, i) => (i === 15 ? 110 : 100));
    const { alt: out } = smoothForDisplay(tr, { alt });
    // The spike is a triangle 2 s wide and 10 m high: area 10 m·s over a 10 s window.
    expect(out[15]).toBeCloseTo(101, 10);
    expect(out[10]).toBeCloseTo(100.5, 10); // window edge cuts the triangle in half
    expect(out[9]).toBeCloseTo(100, 10); // 6 s away: outside the window
  });

  it('removes sample-to-sample altitude jitter', () => {
    const n = 600;
    const alt = Float64Array.from({ length: n }, (_, i) => 50 + (i % 2 ? 1.5 : -1.5));
    const { alt: out } = smoothForDisplay(track(n), { alt });
    const inner = out.slice(10, -10);
    expect(Math.max(...inner) - Math.min(...inner)).toBeLessThan(0.3); // was 3 m peak to peak
  });

  it('keeps a straight constant-speed line exactly straight', () => {
    const n = 100;
    const xs = Float64Array.from({ length: n }, (_, i) => i * 3);
    const { x } = smoothForDisplay(track(n), { x: xs });
    for (let i = 5; i < n - 5; i++) expect(x[i]).toBeCloseTo(xs[i], 9);
  });

  it('does not create zig-zag from uneven fix spacing (bursts of sub-second fixes)', () => {
    // Walking at 1.4 m/s in a straight line, but fixes arrive irregularly like a real phone.
    const times = [];
    let tm = 0;
    for (let i = 0; i < 400; i++) {
      tm += i % 7 === 0 ? 200 : i % 5 === 0 ? 2600 : 1000;
      times.push(tm);
    }
    const tr = track(times.length, { time: (i) => times[i] });
    const xs = Float64Array.from(times, (ms) => (ms / 1000) * 1.4);
    const { x } = smoothForDisplay(tr, { x: xs });
    // Index-based zig-zag is non-zero even for the raw line here (uneven steps), so check
    // that the smoothed line lies exactly on the true one instead.
    for (let i = 15; i < times.length - 15; i++) expect(x[i]).toBeCloseTo(xs[i], 6);
  });

  it('reduces zig-zag on a noisy track instead of adding to it', () => {
    let seed = 3;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const times = [];
    let tm = 0;
    for (let i = 0; i < 800; i++) {
      tm += 400 + Math.abs(rand()) * 1600;
      times.push(tm);
    }
    const xs = Float64Array.from(times, (ms) => (ms / 1000) * 1.4 + rand() * 4);
    const { x } = smoothForDisplay(track(times.length, { time: (i) => times[i] }), { x: xs });
    expect(zigzag(x)).toBeLessThan(zigzag(xs) * 0.2);
  });

  it('never averages across a pause (segments)', () => {
    const tr = track(40, { seg: (i) => (i < 20 ? 0 : 1) });
    const alt = Float64Array.from({ length: 40 }, (_, i) => (i < 20 ? 100 : 200));
    const { alt: out } = smoothForDisplay(tr, { alt });
    expect(out[19]).toBe(100);
    expect(out[20]).toBe(200);
  });

  it('fills missing altitude by interpolation', () => {
    const tr = track(10, { time: (i) => i * 4000 });
    const alt = Float64Array.from([10, 20, NaN, 40, 50, 60, 70, 80, 90, 100]);
    const { alt: out } = smoothForDisplay(tr, { alt });
    expect(out[5]).toBeCloseTo(60, 10); // linear signal: the centred mean is the value itself
    expect(Number.isFinite(out[2])).toBe(true);
  });

  it('smooths several columns in one call (speed colours too)', () => {
    const speed = Float64Array.from({ length: 40 }, (_, i) => (i % 2 ? 4 : 2));
    const alt = Float64Array.from({ length: 40 }, () => 7);
    const out = smoothForDisplay(track(40), { speed, alt });
    expect(Math.abs(out.speed[20] - 3)).toBeLessThan(0.11);
    expect(out.alt[20]).toBe(7);
  });
});

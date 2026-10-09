// Sequential speed ramp (slow → fast). Shared by map, 3D and legends.

const STOPS = [
  [0.0, [59, 130, 246]],
  [0.25, [6, 182, 212]],
  [0.5, [34, 197, 94]],
  [0.75, [234, 179, 8]],
  [1.0, [239, 68, 68]],
];

export function rampRGB(t) {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  for (let k = 1; k < STOPS.length; k++) {
    const [t1, c1] = STOPS[k];
    if (x <= t1) {
      const [t0, c0] = STOPS[k - 1];
      const f = (x - t0) / (t1 - t0);
      return c0.map((v, i) => Math.round(v + (c1[i] - v) * f));
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export function rampHex(t) {
  return '#' + rampRGB(t).map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function rampCSS() {
  return `linear-gradient(90deg, ${STOPS.map(([t, c]) => `rgb(${c.join(' ')}) ${t * 100}%`).join(', ')})`;
}

/** Robust speed range for colouring (5th–95th percentile of moving speeds). */
export function speedRange(track) {
  const vals = [];
  for (let i = 0; i < track.n; i++) if (track.moving[i]) vals.push(track.speed[i]);
  if (vals.length < 2) return [0, Math.max(1, ...Array.from(track.speed))];
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.05)];
  const hi = vals[Math.floor(vals.length * 0.95)];
  return hi - lo < 0.5 ? [lo, lo + 0.5] : [lo, hi];
}

// Deterministic synthetic GNSS route used by unit tests and the browser simulator.

import { destination } from '../geo/geo.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const BASE_SPEED = { walk: 1.4, run: 3.1, cycle: 7.5, ski: 11 };

/**
 * A route generator that advances in true position and emits noisy fixes.
 * Ski alternates 6-minute lifts (straight climbs) with zig-zag descents.
 */
export class SyntheticRoute {
  constructor({ activity = 'run', lat = 50.1163, lon = -122.9574, alt = 680, seed = 7, noise = 3, stops = true } = {}) {
    this.activity = activity;
    this.lat = lat;
    this.lon = lon;
    this.alt = alt;
    this.baseAlt = alt;
    this.rand = mulberry32(seed);
    this.noise = noise;
    this.stops = stops;
    this.heading = 40;
    this.elapsed = 0;
    this.dist = 0;
    this.phase = activity === 'ski' ? 'lift' : 'move';
    this.phaseLeft = activity === 'ski' ? 360 : Infinity;
    this.stopLeft = 0;
    this.nextStopAt = 240 + this.rand() * 120;
  }

  /** Advance by dt seconds; returns a journal-style point (without seq/seg). */
  step(dt, t) {
    this.elapsed += dt;
    let speed = BASE_SPEED[this.activity] ?? 3;
    let climbRate = 0;

    if (this.activity === 'ski') {
      this.phaseLeft -= dt;
      if (this.phaseLeft <= 0) {
        this.phase = this.phase === 'lift' ? 'run' : 'lift';
        this.phaseLeft = this.phase === 'lift' ? 360 : 200;
        this.heading = (this.heading + 180) % 360;
      }
      if (this.phase === 'lift') {
        speed = 4.5;
        climbRate = 1.1;
      } else {
        speed = 9 + 5 * Math.sin(this.elapsed / 9);
        climbRate = -2.0;
        this.heading += 25 * Math.sin(this.elapsed / 6) * dt * 0.2;
      }
    } else {
      // Rolling terrain: ~40 m amplitude over ~2 km.
      const prevAlt = this.baseAlt + 40 * Math.sin(this.dist / 320) + 12 * Math.sin(this.dist / 90);
      const nextAlt = this.baseAlt + 40 * Math.sin((this.dist + speed * dt) / 320) + 12 * Math.sin((this.dist + speed * dt) / 90);
      climbRate = (nextAlt - prevAlt) / dt;
      speed *= 1 - Math.max(-0.25, Math.min(0.35, climbRate / speed)) * 0.8;
      this.heading += (8 * Math.sin(this.elapsed / 37) + 3 * gaussian(this.rand)) * dt * 0.3;
      if (this.stops) {
        if (this.stopLeft > 0) {
          this.stopLeft -= dt;
          speed = 0;
          climbRate = 0;
        } else if (this.elapsed >= this.nextStopAt) {
          this.stopLeft = 20 + this.rand() * 25;
          this.nextStopAt = this.elapsed + 300 + this.rand() * 200;
        }
      }
    }

    const moved = speed * dt;
    if (moved > 0) {
      [this.lat, this.lon] = destination(this.lat, this.lon, this.heading, moved);
      this.dist += moved;
    }
    this.alt += climbRate * dt;

    const ha = Math.max(2, this.noise + Math.abs(gaussian(this.rand)) * this.noise * 0.6);
    const [nlat, nlon] = destination(this.lat, this.lon, this.rand() * 360, Math.abs(gaussian(this.rand)) * ha * 0.5);
    const pressure = 1013.25 * Math.pow(1 - this.alt / 44330, 5.255);
    return {
      t,
      lat: nlat,
      lon: nlon,
      ha: round(ha, 1),
      ae: round(this.alt + 18 + gaussian(this.rand) * 6, 2),
      am: round(this.alt + gaussian(this.rand) * 6, 2),
      va: round(ha * 1.6, 1),
      sp: round(Math.max(0, speed + gaussian(this.rand) * 0.15), 2),
      sa: 0.4,
      br: round(((this.heading % 360) + 360) % 360, 1),
      ba: 8,
      pr: round(pressure, 3),
      af: round(this.alt + gaussian(this.rand) * 0.4, 2),
      sv: 18 + Math.floor(this.rand() * 8),
      _trueAlt: this.alt,
      _trueDist: this.dist,
    };
  }
}

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Generate a complete journal text.
 * @param {object} opts
 * @param {string} opts.activity
 * @param {number} opts.seconds   active recording length
 * @param {Array<[number, number]>} [opts.pauses]  [atSecond, durationSeconds]
 */
export function generateJournal({ activity = 'run', seconds = 1800, pauses = [], startedAt = Date.UTC(2026, 0, 10, 15, 0, 0), seed = 7, noise = 3, stops = true, hasBarometer = true } = {}) {
  const route = new SyntheticRoute({ activity, seed, noise, stops });
  const lines = [];
  const workoutId = `syn-${activity}-${seed}`;
  lines.push({ type: 'meta', v: 1, workoutId, activity, startedAt, autoPause: false, hasBarometer, device: 'synthetic' });
  lines.push({ type: 'state', t: startedAt, state: 'recording', reason: 'start', seg: 0 });
  let t = startedAt;
  let seg = 0;
  let seq = 0;
  let trueDist = 0;
  const pauseQueue = [...pauses].sort((a, b) => a[0] - b[0]);
  for (let s = 1; s <= seconds; s++) {
    t += 1000;
    const p = route.step(1, t);
    trueDist = p._trueDist;
    delete p._trueAlt;
    delete p._trueDist;
    if (!hasBarometer) {
      delete p.pr;
      p.af = p.am;
    }
    lines.push({ type: 'pt', s: ++seq, ...p, seg });
    if (pauseQueue.length && s === pauseQueue[0][0]) {
      const [, dur] = pauseQueue.shift();
      lines.push({ type: 'state', t, state: 'paused', reason: 'pause', seg });
      t += dur * 1000;
      seg++;
      lines.push({ type: 'state', t, state: 'recording', reason: 'resume', seg });
    }
  }
  lines.push({ type: 'state', t, state: 'idle', reason: 'stop', seg });
  lines.push({ type: 'end', t });
  return { text: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', trueDistance: trueDist, workoutId };
}

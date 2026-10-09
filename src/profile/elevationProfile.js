// Canvas elevation profile ("side view") with a draggable distance cursor.

import { sampleAtDistance } from '../geo/process.js';
import { cssVar } from '../ui/dom.js';
import { altitudeUnit, altitudeValue, distanceValue } from '../units.js';

const PAD = { l: 46, r: 12, t: 14, b: 22 };

export class ElevationProfile {
  /**
   * @param {HTMLElement} container
   * @param {{track:object, units:string, splitLen:number, onScrub:(dist:number)=>void}} opts
   */
  constructor(container, { track, units, splitLen, onScrub }) {
    this.container = container;
    this.track = track;
    this.units = units;
    this.splitLen = splitLen;
    this.onScrub = onScrub;
    this.cursor = null;
    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-label', 'Elevation profile. Drag to scrub along the route.');
    this.canvas.setAttribute('role', 'img');
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');
    this.total = track.n ? track.dist[track.n - 1] : 0;
    this.computeRange();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);

    this.dragging = false;
    this.onDown = (e) => {
      this.dragging = true;
      this.canvas.setPointerCapture(e.pointerId);
      this.scrubTo(e);
    };
    this.onMove = (e) => {
      if (this.dragging) this.scrubTo(e);
    };
    this.onUp = () => {
      this.dragging = false;
    };
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointermove', this.onMove);
    this.canvas.addEventListener('pointerup', this.onUp);
    this.canvas.addEventListener('pointercancel', this.onUp);
  }

  computeRange() {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < this.track.n; i++) {
      const a = this.track.alt[i];
      if (Number.isFinite(a)) {
        if (a < lo) lo = a;
        if (a > hi) hi = a;
      }
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 10;
    }
    const span = Math.max(20, hi - lo);
    const mid = (hi + lo) / 2;
    this.altMin = mid - span * 0.6;
    this.altMax = mid + span * 0.6;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  x(d) {
    return PAD.l + (this.total > 0 ? d / this.total : 0) * (this.w - PAD.l - PAD.r);
  }

  y(a) {
    return PAD.t + (1 - (a - this.altMin) / (this.altMax - this.altMin)) * (this.h - PAD.t - PAD.b);
  }

  distAtX(px) {
    const f = (px - PAD.l) / (this.w - PAD.l - PAD.r);
    return Math.max(0, Math.min(1, f)) * this.total;
  }

  scrubTo(e) {
    const rect = this.canvas.getBoundingClientRect();
    const d = this.distAtX(e.clientX - rect.left);
    this.setCursor(d);
    this.onScrub?.(d);
  }

  setCursor(d) {
    this.cursor = d;
    this.draw();
  }

  draw() {
    const { ctx, w, h, track } = this;
    if (!w) return;
    const accent = cssVar('--accent', this.container) || '#f2672e';
    const textDim = cssVar('--text-dim') || '#888';
    const border = cssVar('--border') || '#ccc';
    const surface = cssVar('--surface') || '#fff';
    ctx.clearRect(0, 0, w, h);
    ctx.font = '11px system-ui, Roboto, sans-serif';

    // Horizontal grid + altitude labels.
    const ticks = niceTicks(altitudeValue(this.altMin, this.units), altitudeValue(this.altMax, this.units), 4);
    ctx.strokeStyle = border;
    ctx.fillStyle = textDim;
    ctx.lineWidth = 1;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tv of ticks) {
      const m = this.units === 'imperial' ? tv / 3.28084 : tv;
      const yy = Math.round(this.y(m)) + 0.5;
      if (yy < PAD.t - 2 || yy > h - PAD.b + 2) continue;
      ctx.beginPath();
      ctx.moveTo(PAD.l, yy);
      ctx.lineTo(w - PAD.r, yy);
      ctx.stroke();
      ctx.fillText(`${Math.round(tv)}${altitudeUnit(this.units)}`, PAD.l - 6, yy);
    }

    // Split ticks along the x axis.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const splitCount = Math.floor(this.total / this.splitLen);
    const every = Math.max(1, Math.ceil(splitCount / Math.max(1, Math.floor((w - PAD.l) / 34))));
    for (let k = every; k <= splitCount; k += every) {
      const xx = Math.round(this.x(k * this.splitLen)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(xx, h - PAD.b);
      ctx.lineTo(xx, h - PAD.b + 4);
      ctx.stroke();
      ctx.fillText(String(k), xx, h - PAD.b + 6);
    }
    ctx.textAlign = 'left';
    ctx.fillText(this.units === 'imperial' ? 'mi' : 'km', 6, h - PAD.b + 6);

    if (track.n < 2) return;

    // Area + line.
    const step = Math.max(1, Math.floor(track.n / (w * 2)));
    ctx.beginPath();
    ctx.moveTo(this.x(track.dist[0]), this.y(track.alt[0]));
    for (let i = step; i < track.n; i += step) ctx.lineTo(this.x(track.dist[i]), this.y(track.alt[i]));
    ctx.lineTo(this.x(track.dist[track.n - 1]), this.y(track.alt[track.n - 1]));
    ctx.lineTo(this.x(this.total), h - PAD.b);
    ctx.lineTo(this.x(0), h - PAD.b);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, PAD.t, 0, h - PAD.b);
    grad.addColorStop(0, withAlpha(accent, 0.45));
    grad.addColorStop(1, withAlpha(accent, 0.04));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(this.x(track.dist[0]), this.y(track.alt[0]));
    for (let i = step; i < track.n; i += step) ctx.lineTo(this.x(track.dist[i]), this.y(track.alt[i]));
    ctx.lineTo(this.x(track.dist[track.n - 1]), this.y(track.alt[track.n - 1]));
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Cursor.
    if (this.cursor != null) {
      const s = sampleAtDistance(track, this.cursor);
      const cx = this.x(this.cursor);
      const cy = this.y(s.alt);
      ctx.strokeStyle = textDim;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(Math.round(cx) + 0.5, PAD.t - 6);
      ctx.lineTo(Math.round(cx) + 0.5, h - PAD.b);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = accent;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = surface;
      ctx.stroke();

      const label = `${Math.round(altitudeValue(s.alt, this.units))} ${altitudeUnit(this.units)} · ${distanceValue(this.cursor, this.units).toFixed(2)}`;
      ctx.font = '600 11px system-ui, Roboto, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      const lx = Math.min(Math.max(cx - tw / 2, PAD.l), w - PAD.r - tw);
      const ly = Math.max(2, Math.min(cy - 28, h - PAD.b - 22));
      ctx.fillStyle = surface;
      roundRect(ctx, lx, ly, tw, 18, 6);
      ctx.fill();
      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = cssVar('--text') || '#000';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lx + 6, ly + 9);
    }
  }

  destroy() {
    this.ro.disconnect();
    this.canvas.remove();
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function withAlpha(color, a) {
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    const hex = color.length === 4 ? color.replace(/^#(.)(.)(.)$/, '#$1$1$2$2$3$3') : color;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }
  return color;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo;
  if (span <= 0) return [lo];
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}

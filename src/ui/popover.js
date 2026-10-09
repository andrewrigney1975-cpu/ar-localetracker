// Floating info popover anchored to a screen point within a container.
// Shared by the 2D map and the 3D view so distance markers look identical.

import { formatAltitude, formatClock, formatCoord, formatDistance, formatDuration } from '../units.js';
import { el, escapeHtml } from './dom.js';

export class Popover {
  constructor(container) {
    this.container = container;
    this.node = null;
    this.onClose = null;
  }

  show(x, y, html) {
    this.close(false);
    this.node = el(`<div class="popover" role="dialog">${html}</div>`);
    this.node.querySelector('[data-close]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.close();
    });
    this.node.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.container.appendChild(this.node);
    this.move(x, y);
  }

  move(x, y) {
    if (!this.node) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const visible = x >= -20 && y >= -20 && x <= w + 20 && y <= h + 20;
    this.node.style.display = visible ? '' : 'none';
    const half = this.node.offsetWidth / 2;
    const cx = Math.min(Math.max(x, half + 6), w - half - 6);
    this.node.style.left = `${cx}px`;
    this.node.style.top = `${y}px`;
    // Flip below the anchor when there is no room above.
    this.node.classList.toggle('below', y - this.node.offsetHeight - 20 < 0);
  }

  get open() {
    return Boolean(this.node);
  }

  close(notify = true) {
    if (!this.node) return;
    this.node.remove();
    this.node = null;
    if (notify) this.onClose?.();
  }
}

/** Popover body for a distance marker / track sample. */
export function markerInfoHTML({ title, sample, units }) {
  const rows = [
    ['Distance', formatDistance(sample.dist, units)],
    ['Time', formatDuration(sample.active)],
    ['Clock', formatClock(sample.t)],
    ['Latitude', formatCoord(sample.lat, 'lat')],
    ['Longitude', formatCoord(sample.lon, 'lon')],
    ['Altitude', formatAltitude(sample.alt, units)],
  ];
  if (sample.extra) rows.push(...sample.extra);
  return `
    <h3><span>${escapeHtml(title)}</span><button data-close aria-label="Close">×</button></h3>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>`;
}

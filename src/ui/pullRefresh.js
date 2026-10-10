// Pull-to-refresh for a scrolling view body: drag down from the top, release past the
// threshold, and a spinner shows until `onRefresh` settles.

import { el } from './dom.js';

const THRESHOLD = 64;
const MAX = 104;
const HOLD = 52;
const MIN_SPIN_MS = 500;

/**
 * @param {HTMLElement} scroller  the scrolling element (e.g. `.screen > .body`)
 * @param {() => Promise<unknown>} onRefresh
 * @returns {() => void} disposer
 */
export function pullToRefresh(scroller, onRefresh) {
  const content = scroller.firstElementChild;
  const ind = el('<div class="ptr" role="status" aria-label="Refreshing" hidden><div class="ptr-ring"></div></div>');
  scroller.prepend(ind);

  let startY = null;
  let pull = 0;
  let busy = false;

  const set = (px, animate) => {
    const t = animate ? 'transform 0.25s ease, opacity 0.25s ease' : 'none';
    content.style.transition = t;
    ind.style.transition = t;
    content.style.transform = px ? `translateY(${px}px)` : '';
    ind.hidden = px === 0 && !busy;
    ind.style.transform = `translateY(${px - 44}px) rotate(${busy ? 0 : px * 4}deg)`;
    ind.style.opacity = String(Math.min(1, px / THRESHOLD));
    ind.classList.toggle('ready', px >= THRESHOLD);
  };

  const onStart = (e) => {
    if (busy || scroller.scrollTop > 0 || e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    pull = 0;
  };

  const onMove = (e) => {
    if (startY == null) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0 || scroller.scrollTop > 0) {
      if (pull) set((pull = 0));
      if (dy < 0) startY = null; // scrolling up: not a pull
      return;
    }
    e.preventDefault(); // stop the WebView's own overscroll stretch
    pull = Math.min(MAX, dy * 0.5);
    set(pull);
  };

  const onEnd = async () => {
    if (startY == null) return;
    startY = null;
    if (pull < THRESHOLD) {
      set((pull = 0), true);
      return;
    }
    busy = true;
    navigator.vibrate?.(15);
    ind.classList.add('spinning');
    set(HOLD, true);
    await Promise.all([Promise.resolve().then(onRefresh).catch((err) => console.error(err)), new Promise((r) => setTimeout(r, MIN_SPIN_MS))]);
    busy = false;
    ind.classList.remove('spinning');
    set((pull = 0), true);
  };

  scroller.addEventListener('touchstart', onStart, { passive: true });
  scroller.addEventListener('touchmove', onMove, { passive: false });
  scroller.addEventListener('touchend', onEnd);
  scroller.addEventListener('touchcancel', onEnd);
  return () => {
    scroller.removeEventListener('touchstart', onStart);
    scroller.removeEventListener('touchmove', onMove);
    scroller.removeEventListener('touchend', onEnd);
    scroller.removeEventListener('touchcancel', onEnd);
    ind.remove();
  };
}

// Screenshots of part of the app, for sharing. Native only: LocaleScreenPlugin copies the
// screen with PixelCopy, so maps and 3D views come out as shown. In the browser there is no
// capture and callers fall back to text.
//
// To use on any screen: mark controls that shouldn't appear in the image (buttons, the
// action row) with `data-shot-hide`, then capture the element that holds what to show.

import { Capacitor, registerPlugin } from '@capacitor/core';

const Native = registerPlugin('LocaleScreen');

/** True where a screenshot can be taken (the Android app). */
export const canCaptureScreen = () => Capacitor.isNativePlatform();

const pad = (n) => String(n).padStart(2, '0');

/** "locale-location-20261021-0812.png": a filename for a screenshot of `what`, local time. */
export function screenshotName(what, d = new Date()) {
  return `locale-${what}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.png`;
}

/**
 * Intersect a rectangle with clipping rectangles (all {left, top, right, bottom}).
 * @returns {{x:number, y:number, width:number, height:number} | null} null when nothing is left
 */
export function clipRect(rect, clips) {
  let { left, top, right, bottom } = rect;
  for (const c of clips) {
    left = Math.max(left, c.left);
    top = Math.max(top, c.top);
    right = Math.min(right, c.right);
    bottom = Math.min(bottom, c.bottom);
  }
  if (right - left < 1 || bottom - top < 1) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * The part of an element visible on screen: clipped by scrolling ancestors and the viewport,
 * and ending below its last child that is shown, so hidden controls at the bottom (an action
 * row) leave no empty band.
 */
function visibleRect(element) {
  const clips = [{ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }];
  for (let p = element.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (/auto|scroll|hidden|clip/.test(overflowX + overflowY)) clips.push(p.getBoundingClientRect());
  }
  const r = element.getBoundingClientRect();
  const shown = [...element.children].filter((c) => !c.matches('[data-shot-hide]') && c.getClientRects().length);
  const bottom = shown.length
    ? Math.min(r.bottom, Math.max(...shown.map((c) => c.getBoundingClientRect().bottom)) + parseFloat(getComputedStyle(element).paddingBottom || '0'))
    : r.bottom;
  return clipRect({ left: r.left, top: r.top, right: r.right, bottom }, clips);
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * Screenshot of the visible part of `element`, with `[data-shot-hide]` controls and toasts
 * hidden while it is taken.
 * @param {Element} element
 * @param {{filename?: string}} [opts]
 * @returns {Promise<{uri:string, width:number, height:number} | null>} null where capture isn't available
 */
export async function captureElement(element, { filename = 'screenshot.png' } = {}) {
  if (!canCaptureScreen()) return null;
  const rect = visibleRect(element);
  if (!rect) return null;
  const html = document.documentElement;
  html.classList.add('capturing');
  try {
    // PixelCopy reads the last frame the compositor showed: let the hidden controls go first.
    await nextFrame();
    await nextFrame();
    await new Promise((r) => setTimeout(r, 50));
    return await Native.captureScreen({ ...rect, filename });
  } finally {
    html.classList.remove('capturing');
  }
}

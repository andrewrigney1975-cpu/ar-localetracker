// Tiny DOM helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Create an element from an HTML string (single root). */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Add an event listener and return a disposer. */
export function on(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  return () => target.removeEventListener(type, fn, opts);
}

/** Collects disposers so a view can clean up in one call. */
export class Disposer {
  constructor() {
    this.fns = [];
  }
  add(fn) {
    if (typeof fn === 'function') this.fns.push(fn);
    return fn;
  }
  dispose() {
    while (this.fns.length) {
      try {
        this.fns.pop()();
      } catch (e) {
        console.error(e);
      }
    }
  }
}

/** Read a CSS custom property from an element (default: root). */
export function cssVar(name, elm = document.documentElement) {
  return getComputedStyle(elm).getPropertyValue(name).trim();
}

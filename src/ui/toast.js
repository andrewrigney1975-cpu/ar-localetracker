import { el, escapeHtml } from './dom.js';

let host = null;

export function toast(message, ms = 2600) {
  if (!host) {
    host = el('<div class="toast-host" aria-live="polite"></div>');
    document.body.appendChild(host);
  }
  const t = el(`<div class="toast">${escapeHtml(message)}</div>`);
  host.replaceChildren(t);
  setTimeout(() => t.remove(), ms);
}

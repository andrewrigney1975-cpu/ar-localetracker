// Modal bottom-sheet dialogs. Never use window.alert/confirm (they block the WebView).

import { el, escapeHtml } from './dom.js';

let backHandler = null;

/** Called by the Android back button; returns true if a dialog was closed. */
export function closeTopDialog() {
  if (backHandler) {
    backHandler();
    return true;
  }
  return false;
}

/**
 * Open a dialog. `build(dialogEl, close)` fills the content.
 * @returns {Promise<any>} resolves with the value passed to close()
 */
export function openDialog(build, { dismissable = true } = {}) {
  return new Promise((resolve) => {
    const scrim = el('<div class="dialog-scrim" role="presentation"><div class="dialog" role="dialog" aria-modal="true"></div></div>');
    const dialog = scrim.firstElementChild;
    const prevHandler = backHandler;
    const close = (value) => {
      scrim.remove();
      backHandler = prevHandler;
      resolve(value);
    };
    if (dismissable) {
      scrim.addEventListener('click', (e) => {
        if (e.target === scrim) close(undefined);
      });
      backHandler = () => close(undefined);
    } else {
      backHandler = () => {};
    }
    build(dialog, close);
    document.body.appendChild(scrim);
    dialog.querySelector('[autofocus]')?.focus();
  });
}

export function confirmDialog({ title, message, confirmLabel = 'OK', cancelLabel = 'Cancel', danger = false }) {
  return openDialog((d, close) => {
    d.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <div class="actions">
        <button class="btn ghost" data-v="0">${escapeHtml(cancelLabel)}</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${escapeHtml(confirmLabel)}</button>
      </div>`;
    d.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => close(b.dataset.v === '1')));
  }).then(Boolean);
}

/** Multiple-choice dialog; returns the chosen option id or undefined. */
export function choiceDialog({ title, message, options, dismissable = true }) {
  return openDialog((d, close) => {
    d.innerHTML = `
      <h2>${escapeHtml(title)}</h2>
      ${message ? `<p>${escapeHtml(message)}</p>` : ''}
      <div class="actions"></div>`;
    const actions = d.querySelector('.actions');
    for (const o of options) {
      const b = el(`<button class="btn ${o.style ?? 'ghost'}">${escapeHtml(o.label)}</button>`);
      b.addEventListener('click', () => close(o.id));
      actions.appendChild(b);
    }
  }, { dismissable });
}

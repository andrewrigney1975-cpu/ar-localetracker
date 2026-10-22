// Segmented control markup (Settings, You and their dialogs). Wire clicks on `[data-seg] button`.

/** `options` are [value, label] pairs; the button matching `value` is pressed. */
export function segmented(name, options, value) {
  return `<div class="segmented" role="group" data-seg="${name}">
    ${options.map(([v, label]) => `<button data-v="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}
  </div>`;
}

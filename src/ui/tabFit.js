// Which tabs stay on a one-row tab bar; the rest go into a ⋮ menu (main.js fitTabbar).

/**
 * @param {number} count tabs
 * @param {number} width usable bar width (px)
 * @param {number} need narrowest a tab may be (px): the minimum, or the widest label if wider
 * @param {number} current index of the current tab, or -1
 * @returns {{shown: number[], more: boolean}} indexes of the tabs on the bar, in order
 */
export function fitTabs(count, width, need, current) {
  const all = [...Array(count).keys()];
  const fit = Math.floor(width / need);
  if (fit >= count) return { shown: all, more: false };
  const k = Math.max(1, fit - 1); // room for the ⋮ button
  const shown = all.slice(0, k);
  // The current tab always stays, taking the place of the last one that fits.
  if (current >= k) shown[k - 1] = current;
  return { shown, more: true };
}

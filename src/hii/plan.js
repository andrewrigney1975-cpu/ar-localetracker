// High-intensity interval (HII) plans: randomised bouts of walking, jogging, running and
// sprinting (backlog 12). Pure and seeded, so the browser simulator, TrackingService
// (HiiPlan.java) and the saved workout all see the same plan. tests/hii.test.js writes a
// shared fixture that HiiPlanTest replays; keep planIntervals() and the Java port in step.

import { mulberry32 } from '../tracker/synthetic.js';

export const HII_MODES = ['walk', 'jog', 'run', 'sprint'];
export const HII_LABELS = { walk: 'Walk', jog: 'Jog', run: 'Run', sprint: 'Sprint' };
/** Bouts are whole multiples of this many seconds. */
export const UNIT_S = 5;
/** Seconds before each change that "Get ready…" is said. */
export const WARN_S = 10;
/** Shortest plan worth starting part-way through a workout. */
export const MIN_PLAN_S = 120;

/** Defaults for settings().hii: share of the time per mode (%), bout lengths (s), and minutes when no routine says. */
export const HII_DEFAULTS = {
  shares: { walk: 40, jog: 30, run: 20, sprint: 10 },
  bouts: { walk: [60, 240], jog: [60, 180], run: [45, 120], sprint: [15, 45] },
  durationMin: 30,
};

const HARD = new Set(['run', 'sprint']);

/**
 * A plan of `durationS` (rounded down to UNIT_S) in which each mode's time is its share,
 * split into bouts between the mode's min and max length where the totals allow. Order is
 * random with two rules: a run or a sprint is always followed by a walk (so a sprint never
 * follows a run), and the plan prefers not to start hard or repeat a mode back to back.
 * @param {{durationS:number, shares:Record<string,number>, bouts:Record<string,[number,number]>, seed:number}} o
 * @returns {{durationS:number, items:[string, number, number][]}} items: [mode, startS, durationS]
 */
export function planIntervals({ durationS, shares, bouts, seed }) {
  const rand = mulberry32(seed);
  const pick = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const n = Math.max(0, Math.floor(durationS / UNIT_S));

  // Each mode's units; the rounding remainder goes to the largest fractions (ties in mode order).
  const sum = HII_MODES.reduce((a, m) => a + Math.max(0, Math.round(shares[m] ?? 0)), 0) || 1;
  const share = (m) => Math.max(0, Math.round(shares[m] ?? 0));
  const total = {};
  let left = n;
  for (const m of HII_MODES) {
    total[m] = Math.floor((n * share(m)) / sum);
    left -= total[m];
  }
  const byFraction = [...HII_MODES].sort((a, b) => ((n * share(b)) % sum) - ((n * share(a)) % sum) || HII_MODES.indexOf(a) - HII_MODES.indexOf(b));
  for (let i = 0; left > 0; i = (i + 1) % byFraction.length, left--) total[byFraction[i]]++;

  // Bout counts within the limits; enough walks to follow every hard bout.
  const lim = {};
  for (const m of HII_MODES) {
    const [minS, maxS] = bouts[m] ?? HII_DEFAULTS.bouts[m];
    const lo = Math.max(1, Math.ceil(minS / UNIT_S));
    lim[m] = [lo, Math.max(lo, Math.floor(maxS / UNIT_S))];
  }
  const range = (m) => {
    const t = total[m];
    if (!t) return [0, 0];
    const fewest = Math.ceil(t / lim[m][1]);
    return [fewest, Math.max(fewest, Math.floor(t / lim[m][0]))];
  };
  // Counts from the fewest bouts up to the number of mid-length ones, so bouts vary in length
  // rather than crowding at the minimum.
  const typical = (m) => {
    const [fewest, most] = range(m);
    const mid = Math.round((2 * total[m]) / (lim[m][0] + lim[m][1]));
    return [fewest, Math.min(most, Math.max(fewest, mid))];
  };
  const count = {};
  for (const m of ['run', 'sprint', 'jog']) count[m] = pick(...typical(m));
  const wMax = range('walk')[1];
  // Too few walks to go round: fewer, longer hard bouts (then, if need be, shorter walks).
  while (count.run + count.sprint > wMax && (count.run > range('run')[0] || count.sprint > range('sprint')[0])) {
    if (count.run > range('run')[0]) count.run--;
    else count.sprint--;
  }
  const hard = count.run + count.sprint;
  count.walk = total.walk ? Math.min(total.walk, Math.max(hard, pick(...typical('walk')))) : 0;

  const parts = {};
  for (const m of HII_MODES) parts[m] = split(total[m], count[m], lim[m], rand);

  // Blocks: each hard bout with the walk that follows it, then the free walks and jogs.
  const blocks = [];
  const walks = [...parts.walk];
  for (const m of ['run', 'sprint']) for (const p of parts[m]) blocks.push(walks.length ? [[m, p], ['walk', walks.shift()]] : [[m, p]]);
  for (const p of walks) blocks.push([['walk', p]]);
  for (const p of parts.jog) blocks.push([['jog', p]]);

  let best = null;
  let bestScore = Infinity;
  for (let attempt = 0; attempt < 40 && bestScore > 0; attempt++) {
    const order = shuffle(blocks, rand);
    const s = score(order);
    if (s < bestScore) {
      bestScore = s;
      best = order;
    }
  }

  // Flatten, joining back-to-back bouts of the same mode.
  const items = [];
  let at = 0;
  for (const [m, u] of (best ?? []).flat()) {
    const last = items[items.length - 1];
    if (last && last[0] === m) last[2] += u * UNIT_S;
    else items.push([m, at, u * UNIT_S]);
    at += u * UNIT_S;
  }
  return { durationS: n * UNIT_S, items };
}

/** `t` units in `k` parts, each within [lo, hi] when possible, randomly. */
function split(t, k, [lo, hi], rand) {
  if (!k) return [];
  if (k * lo >= t) {
    // Not enough time for k bouts of the minimum: equal parts.
    const base = Math.floor(t / k);
    return Array.from({ length: k }, (_, i) => base + (i < t - base * k ? 1 : 0));
  }
  const out = new Array(k).fill(lo);
  let rest = t - k * lo;
  // Feasible: k ≥ ceil(t / hi), so the room left is at least `rest`.
  while (rest > 0) {
    const i = Math.floor(rand() * k);
    const free = hi - out[i];
    if (free <= 0) continue;
    const add = 1 + Math.floor(rand() * Math.min(free, rest));
    out[i] += add;
    rest -= add;
  }
  return out;
}

function shuffle(xs, rand) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Lower is better: back-to-back repeats of a mode, and starting with a run or a sprint. */
function score(blocks) {
  let s = blocks.length && HARD.has(blocks[0][0][0]) ? 1 : 0;
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1];
    if (prev[prev.length - 1][0] === blocks[i][0][0]) s += 2;
  }
  return s;
}

/**
 * The plan stored in the journal and on the workout: the inputs, when it began (seconds of
 * active time) and its bouts.
 */
export function makePlan({ durationS, shares, bouts, seed, atS = 0 }) {
  const p = planIntervals({ durationS, shares, bouts, seed });
  return { seed, atS, durationS: p.durationS, shares: { ...shares }, bouts: { ...bouts }, items: p.items };
}

/**
 * Where a plan is at `elapsedS` seconds of active time: the bout index (-1 before, items.length
 * after), its mode, seconds left in it and the next mode. Stopped plans (stopS) end there.
 */
export function hiiAt(plan, elapsedS) {
  const rel = elapsedS - plan.atS;
  const end = plan.stopS != null ? Math.min(plan.durationS, plan.stopS - plan.atS) : plan.durationS;
  const items = plan.items;
  if (rel < 0) return { index: -1, mode: null, leftS: 0, next: items[0]?.[0] ?? null };
  if (rel >= end) return { index: items.length, mode: null, leftS: 0, next: null, done: true };
  let i = 0;
  while (i + 1 < items.length && items[i + 1][1] <= rel) i++;
  const [mode, s, d] = items[i];
  return { index: i, mode, leftS: Math.max(0, s + d - rel), next: items[i + 1]?.[0] ?? null };
}

/** Seconds in each mode, as planned (up to stopS when the plan was stopped). */
export function planTotals(plan) {
  const end = plan.stopS != null ? Math.min(plan.durationS, plan.stopS - plan.atS) : plan.durationS;
  const out = Object.fromEntries(HII_MODES.map((m) => [m, 0]));
  for (const [m, s, d] of plan.items) out[m] += Math.max(0, Math.min(s + d, end) - s);
  return out;
}

/** Shares that add up to 100 and bout limits with min ≤ max, else an error message. */
export function validateHii({ shares, bouts }) {
  const sum = HII_MODES.reduce((a, m) => a + (Number(shares[m]) || 0), 0);
  if (sum !== 100) return `The shares add up to ${sum}%, not 100%`;
  if ((shares.run > 0 || shares.sprint > 0) && !(shares.walk > 0)) return 'Runs and sprints are followed by a walk, so walking needs a share';
  for (const m of HII_MODES) {
    const [lo, hi] = bouts[m];
    if (!(lo >= UNIT_S) || !(hi >= lo)) return `${HII_LABELS[m]}: the shortest bout must be at least ${UNIT_S} s and no longer than the longest`;
  }
  return null;
}

import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { settings } from '../settings.js';
import { Disposer, on } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { formatDistance, formatDuration } from '../units.js';
import { workoutItemHTML } from './home.js';

export async function mount(root) {
  const d = new Disposer();
  const units = settings().units;
  let filter = sessionStorage.getItem('historyFilter') ?? 'all';

  root.innerHTML = `
    <div class="screen">
      <header class="topbar"><h1>History</h1></header>
      <div class="body">
        <div class="page">
          <div class="filter-row" role="toolbar" aria-label="Filter by activity">
            <button class="chip" data-f="all">All</button>
            ${ACTIVITY_IDS.map((id) => `<button class="chip" data-f="${id}" data-activity="${id}">${ACTIVITIES[id].icon}${ACTIVITIES[id].label}</button>`).join('')}
          </div>
          <div data-slot="list"></div>
        </div>
      </div>
    </div>`;

  const chips = [...root.querySelectorAll('[data-f]')];
  const list = root.querySelector('[data-slot="list"]');

  async function render() {
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.f === filter)));
    const all = (await listWorkouts()).filter((w) => filter === 'all' || w.activity === filter);
    if (!all.length) {
      list.innerHTML = `<div class="empty">${icons.history}<div>No workouts yet.</div></div>`;
      return;
    }
    const groups = new Map();
    for (const w of all) {
      const key = new Date(w.startedAt).toLocaleDateString([], { year: 'numeric', month: 'long' });
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    list.innerHTML = [...groups]
      .map(([month, items]) => {
        const dist = items.reduce((a, w) => a + w.summary.distance, 0);
        const time = items.reduce((a, w) => a + w.summary.duration, 0);
        return `
          <div class="section-title month-head"><span>${month}</span><small class="num">${items.length} · ${formatDistance(dist, units, 1)} · ${formatDuration(time)}</small></div>
          <div class="workout-list">${items.map((w) => workoutItemHTML(w, units)).join('')}</div>`;
      })
      .join('');
  }

  chips.forEach((c) =>
    c.addEventListener('click', () => {
      filter = c.dataset.f;
      sessionStorage.setItem('historyFilter', filter);
      render();
    })
  );
  await render();
  d.add(on(window, 'workouts-changed', render));
  return () => d.dispose();
}

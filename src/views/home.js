import { ACTIVITIES, ACTIVITY_IDS, activity } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { settings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { Disposer, escapeHtml, on } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { routeThumbSVG } from '../ui/thumb.js';
import { formatDate, formatDistance, formatDuration } from '../units.js';

export function workoutItemHTML(w, units) {
  const a = activity(w.activity);
  return `
    <a class="workout-item card" href="#/workout/${encodeURIComponent(w.id)}" data-activity="${a.id}">
      ${routeThumbSVG(w.preview)}
      <div style="min-width:0">
        <div class="title">${escapeHtml(w.name)}</div>
        <div class="meta">${formatDate(w.startedAt)}</div>
      </div>
      <div class="stat num">${formatDistance(w.summary.distance, units)}<small>${formatDuration(w.summary.duration)}</small></div>
    </a>`;
}

export async function mount(root) {
  const d = new Disposer();
  const units = settings().units;
  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <h1 class="brand"><span class="brand-mark">${icons.logo}</span> Locale</h1>
      </header>
      <div class="body">
        <div class="page">
          <div data-slot="active"></div>
          <h2 class="hero-title">Start a workout</h2>
          <div class="dim">Choose an activity. GPS starts warming up straight away.</div>
          <div class="activity-grid">
            ${ACTIVITY_IDS.map((id) => {
              const a = ACTIVITIES[id];
              return `<button class="activity-tile" data-activity="${id}" data-go="${id}">
                ${a.icon}
                <span><strong>${a.label}</strong><small>${settings().autoPause[id] ? 'Auto-pause on' : 'Auto-pause off'}</small></span>
              </button>`;
            }).join('')}
          </div>
          <div data-slot="recent"></div>
        </div>
      </div>
    </div>`;

  root.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => {
      location.hash = `#/live/${b.dataset.go}`;
    })
  );

  const renderActive = async () => {
    const slot = root.querySelector('[data-slot="active"]');
    const st = await tracker.getStatus().catch(() => ({ state: 'idle' }));
    if (st.state === 'idle') {
      slot.innerHTML = '';
      return;
    }
    const a = activity(st.activity);
    slot.innerHTML = `
      <a class="banner" href="#/live" data-activity="${a.id}">
        ${a.icon}
        <span class="grow"><strong>${a.verb} in progress</strong><span class="dim num">${formatDuration((st.elapsedMs ?? 0) / 1000)} · ${formatDistance(st.distance ?? 0, units)}</span></span>
        ${icons.back.replace('<svg', '<svg style="transform:rotate(180deg)"')}
      </a>`;
  };

  const renderRecent = async () => {
    const slot = root.querySelector('[data-slot="recent"]');
    const all = await listWorkouts();
    if (!all.length) {
      slot.innerHTML = `<div class="empty">${icons.route}<div>Your workouts will appear here.</div></div>`;
      return;
    }
    slot.innerHTML = `
      <div class="section-title">Recent</div>
      <div class="workout-list">${all.slice(0, 4).map((w) => workoutItemHTML(w, units)).join('')}</div>
      ${all.length > 4 ? '<p style="text-align:center"><a class="btn ghost" href="#/history">See all workouts</a></p>' : ''}`;
  };

  await Promise.all([renderActive(), renderRecent()]);
  d.add(on(window, 'workouts-changed', renderRecent));
  d.add(tracker.on('state', renderActive));
  const timer = setInterval(renderActive, 5000);
  d.add(() => clearInterval(timer));
  return () => d.dispose();
}

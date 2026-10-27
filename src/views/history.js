import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { getRoutineModel, rebuildRoutineModel } from '../insights/model.js';
import { routineBests } from '../insights/trophies.js';
import { syncWorkouts } from '../services/sync.js';
import { settings, updateSettings } from '../settings.js';
import { openDialog } from '../ui/dialog.js';
import { Disposer, on } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { pullToRefresh } from '../ui/pullRefresh.js';
import { toast } from '../ui/toast.js';
import { formatDistance, formatDuration } from '../units.js';
import { workoutItemHTML } from './home.js';

export async function mount(root, params, query, ctx) {
  const d = new Disposer();
  const units = settings().units;
  let filter = sessionStorage.getItem('historyFilter') ?? 'all';
  let all = [];
  /** Selection mode: ids of the workouts picked to mark as a routine, or null when off. */
  let selected = null;

  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <h1 data-ref="title">History</h1>
        <button class="btn ghost small" data-act="select">Select</button>
      </header>
      <div class="body">
        <div class="page">
          <div class="filter-row" role="toolbar" aria-label="Filter by activity">
            <button class="chip" data-f="all">All</button>
            ${ACTIVITY_IDS.map((id) => `<button class="chip" data-f="${id}" data-activity="${id}">${ACTIVITIES[id].icon}${ACTIVITIES[id].label}</button>`).join('')}
          </div>
          <p class="select-hint" data-ref="hint" hidden>Pick two or more workouts of the same route to make a routine. Locale then predicts its goal and names matching workouts after it.</p>
          <div data-slot="list"></div>
        </div>
      </div>
      <div class="selection-bar" data-ref="bar" hidden>
        <span data-ref="count"></span>
        <button class="btn primary" data-act="mark">Mark as routine</button>
      </div>
    </div>`;

  const chips = [...root.querySelectorAll('[data-f]')];
  const list = root.querySelector('[data-slot="list"]');
  const selectBtn = root.querySelector('[data-act="select"]');
  const bar = root.querySelector('[data-ref="bar"]');
  const markBtn = root.querySelector('[data-act="mark"]');

  async function render() {
    chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.f === filter)));
    let model;
    [all, model] = await Promise.all([listWorkouts(), getRoutineModel().catch(() => null)]);
    const bests = routineBests(model, all);
    const shown = all.filter((w) => filter === 'all' || w.activity === filter);
    if (!shown.length) {
      list.innerHTML = `<div class="empty">${icons.history}<div>No workouts yet.</div></div>`;
      return;
    }
    const groups = new Map();
    for (const w of shown) {
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
          <div class="workout-list">${items.map((w) => workoutItemHTML(w, units, bests.get(w.id))).join('')}</div>`;
      })
      .join('');
    syncSelection();
  }

  const idOf = (item) => decodeURIComponent(item.getAttribute('href').replace('#/workout/', ''));

  function syncSelection() {
    const on = selected != null;
    root.querySelector('.screen').classList.toggle('selecting', on);
    root.querySelector('[data-ref="title"]').textContent = on ? 'Select workouts' : 'History';
    selectBtn.textContent = on ? 'Cancel' : 'Select';
    root.querySelector('[data-ref="hint"]').hidden = !on;
    bar.hidden = !on;
    document.querySelector('.tabbar')?.classList.toggle('behind', on);
    list.querySelectorAll('.workout-item').forEach((item) => {
      if (on) item.setAttribute('aria-checked', String(selected.has(idOf(item))));
      else item.removeAttribute('aria-checked');
    });
    if (!on) return;
    const n = selected.size;
    root.querySelector('[data-ref="count"]').textContent = n ? `${n} selected` : 'None selected';
    markBtn.disabled = n < 2;
  }

  const setSelecting = (on) => {
    selected = on ? new Set() : null;
    syncSelection();
  };

  selectBtn.addEventListener('click', () => setSelecting(selected == null));
  // While selecting, the Android back button leaves selection instead of the screen.
  ctx?.setBackHandler(() => {
    if (selected == null) return false;
    setSelecting(false);
    return true;
  });
  d.add(() => document.querySelector('.tabbar')?.classList.remove('behind'));

  list.addEventListener('click', (e) => {
    if (selected == null) return;
    const item = e.target.closest('.workout-item');
    if (!item) return;
    e.preventDefault();
    const id = idOf(item);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    syncSelection();
  });

  markBtn.addEventListener('click', async () => {
    const picked = all.filter((w) => selected.has(w.id));
    const acts = new Set(picked.map((w) => w.activity));
    if (acts.size > 1) {
      toast('Pick workouts of one activity: a routine is a walk, run, ride or ski');
      return;
    }
    const activity = picked[0].activity;
    const routines = settings().routines;
    // Suggest the name the picked workouts already share (an existing routine's label).
    const names = new Set(picked.map((w) => (w.routineLabel ? w.name : null)));
    const suggestion = names.size === 1 ? [...names][0] ?? '' : '';
    const name = await openDialog((dlg, close) => {
      dlg.innerHTML = `
        <h2>Mark as routine</h2>
        <p>${picked.length} ${ACTIVITIES[activity].label.toLowerCase()} workouts. Locale will predict this routine's goal and name matching workouts after it.</p>
        <label class="field"><span>Routine name</span><input type="text" maxlength="40" placeholder="e.g. Lake loop" autofocus /></label>
        <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Create routine</button></div>`;
      const input = dlg.querySelector('input');
      const save = dlg.querySelector('[data-v="save"]');
      input.value = suggestion;
      const sync = () => (save.disabled = !input.value.trim());
      input.addEventListener('input', sync);
      sync();
      dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
      save.addEventListener('click', () => close(input.value.trim()));
    });
    if (!name) return;
    const ids = picked.map((w) => w.id);
    const pickedSet = new Set(ids);
    // A workout belongs to one marked routine: take the picked ones out of any others.
    const others = (routines.user ?? [])
      .map((u) => ({ ...u, workoutIds: u.workoutIds.filter((id) => !pickedSet.has(id)) }))
      .filter((u) => u.workoutIds.length);
    const routine = { id: `u${Date.now().toString(36)}`, name, activity, workoutIds: ids, createdAt: Date.now() };
    await updateSettings({
      routines: {
        ...routines,
        user: [...others, routine],
        excluded: routines.excluded.filter((id) => !pickedSet.has(id)),
        detached: (routines.detached ?? []).filter((id) => !pickedSet.has(id)),
      },
    });
    setSelecting(false);
    try {
      await rebuildRoutineModel();
    } catch (e) {
      console.error(e);
    }
    toast(`Routine “${name}” created`);
  });

  chips.forEach((c) =>
    c.addEventListener('click', () => {
      filter = c.dataset.f;
      sessionStorage.setItem('historyFilter', filter);
      render();
    })
  );
  await render();
  d.add(on(window, 'workouts-changed', render));
  d.add(on(window, 'routines-changed', render));
  // Pull down to pick up workouts recorded from the watch, a widget or the notification.
  d.add(
    pullToRefresh(root.querySelector('.body'), async () => {
      const { imported } = await syncWorkouts();
      if (!imported) toast('Workouts are up to date');
    })
  );
  return () => d.dispose();
}

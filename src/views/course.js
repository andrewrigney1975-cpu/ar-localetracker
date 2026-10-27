// A shared course in View: Map and 3D in course mode (one colour, no time or performance).

import { activity as activityProfile } from '../activities.js';
import { deleteCourse, getCourse } from '../course/courseStore.js';
import { navigate } from '../router.js';
import { settings, updateSettings } from '../settings.js';
import { confirmDialog } from '../ui/dialog.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { formatAltitude, formatDistance } from '../units.js';

const TABS = [
  ['map', 'Map'],
  ['3d', '3D'],
];

export async function mount(root, params, query, ctx) {
  const d = new Disposer();
  const course = await getCourse(params.id).catch((e) => {
    console.error(e);
    return null;
  });
  const back = () => {
    if (history.length > 1) history.back();
    else navigate('/view', { replace: true });
    return true;
  };
  if (!course) {
    root.innerHTML = `<div class="screen"><header class="topbar"><button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button><h1>Not found</h1></header><div class="body"><div class="empty">This course is no longer in View.</div></div></div>`;
    root.querySelector('[data-act="back"]').addEventListener('click', back);
    return null;
  }
  const s = settings();
  const units = s.units;
  const act = course.activity ? activityProfile(course.activity) : null;
  const sm = course.summary;
  // The shape the map and 3D views read from a workout.
  const workout = { id: course.entry.id, name: course.name, activity: act?.id ?? null, summary: sm };
  let tab = TABS.some(([id]) => id === query.tab) ? query.tab : 'map';
  let disposeTab = null;

  const stats = [
    formatDistance(sm.distance, units),
    `+${formatAltitude(sm.elevGain, units)}`,
    `−${formatAltitude(sm.elevLoss, units)}`,
    sm.minAlt != null ? `${formatAltitude(sm.minAlt, units, false)}–${formatAltitude(sm.maxAlt, units)}` : null,
  ].filter(Boolean);

  root.innerHTML = `
    <div class="screen" data-activity="${act?.id ?? 'view'}">
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <h1>${escapeHtml(course.name)}</h1>
        <button class="icon-btn" data-act="delete" aria-label="Remove course">${icons.trash}</button>
      </header>
      <div class="detail">
        <div class="detail-head">
          <span class="activity-badge">${act ? act.icon : icons.route}</span>
          <div class="meta">${escapeHtml(course.sharedBy ? `Shared by ${course.sharedBy}` : 'Course')}${course.trimmed ? ' · start and finish hidden' : ''}<br><span class="num">${escapeHtml(stats.join(' · '))}</span></div>
        </div>
        <div class="tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button role="tab" data-tab="${id}">${label}</button>`).join('')}
        </div>
        <div class="tab-panel fill" role="tabpanel"></div>
      </div>
    </div>`;
  const panel = root.querySelector('.tab-panel');

  async function showTab(id) {
    tab = id;
    history.replaceState(null, '', `#/course/${encodeURIComponent(course.entry.id)}?tab=${id}`);
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    disposeTab?.();
    disposeTab = null;
    panel.innerHTML = '<div class="saving-overlay"><div class="spinner"></div></div>';
    try {
      if (id === 'map') {
        const { mountMapView } = await import('../map/mapView.js');
        if (tab !== id) return;
        disposeTab = mountMapView(panel, {
          workout,
          track: course.track,
          units,
          course: true,
          styleId: settings().mapStyle,
          onStyleChange: (styleId) => updateSettings({ mapStyle: styleId }),
        });
      } else {
        const { mountView3D } = await import('../view3d/view3d.js');
        if (tab !== id) return;
        disposeTab = mountView3D(panel, {
          workout,
          track: course.track,
          units,
          course: true,
          exaggeration: settings().exaggeration,
          terrain: settings().terrain3d,
          onTerrainChange: (on) => updateSettings({ terrain3d: on }),
          smooth: settings().smooth3d,
          onSmoothChange: (on) => updateSettings({ smooth3d: on }),
        });
      }
    } catch (e) {
      console.error(e);
      panel.innerHTML = `<div class="empty">${icons.warning}<div>Could not display this view.<br><small>${escapeHtml(e?.message ?? e)}</small></div></div>`;
    }
  }
  d.add(() => disposeTab?.());

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  root.querySelector('[data-act="back"]').addEventListener('click', back);
  ctx?.setBackHandler(back);
  root.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Remove this course?', message: `“${course.name}” will be removed from View.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    await deleteCourse(course.entry.id);
    navigate('/view', { replace: true });
  });

  await showTab(tab);
  return () => d.dispose();
}

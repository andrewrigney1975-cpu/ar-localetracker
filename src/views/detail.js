import { activity as activityProfile } from '../activities.js';
import { deleteWorkout, getTrack, getWorkout, updateWorkout } from '../db/workouts.js';
import { EXPORT_FORMATS, renderExport } from '../export/index.js';
import { navigate } from '../router.js';
import { workoutShareText, smsUri } from '../export/text.js';
import { openSms, shareFile, shareText } from '../services/share.js';
import { settings, updateSettings } from '../settings.js';
import { estimateCalories, loadLabel, profileComplete, trimp, ZONES, zoneSeconds } from '../stats/physio.js';
import { computeSplits } from '../stats/summary.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { Disposer, el, escapeHtml } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import {
  altitudeUnit,
  altitudeValue,
  distanceUnit,
  distanceValue,
  formatClock,
  formatDate,
  formatDuration,
  formatPace,
  paceUnit,
  speedUnit,
  speedValue,
  splitLength,
} from '../units.js';

const TABS = [
  ['summary', 'Summary'],
  ['map', 'Map'],
  ['3d', '3D'],
  ['splits', 'Splits'],
];

export async function mount(root, params, query, ctx) {
  const d = new Disposer();
  const [workout, track] = await Promise.all([getWorkout(params.id), getTrack(params.id)]);
  if (!workout || !track) {
    root.innerHTML = `<div class="screen"><header class="topbar"><button class="icon-btn" onclick="history.back()" aria-label="Back">${icons.back}</button><h1>Not found</h1></header><div class="body"><div class="empty">This workout no longer exists.</div></div></div>`;
    return null;
  }
  let w = workout;
  const s = settings();
  const units = s.units;
  const act = activityProfile(w.activity);
  const preferSpeed = act.liveSpeedMode === 'speed';
  let tab = TABS.some(([id]) => id === query.tab) ? query.tab : 'summary';
  let disposeTab = null;

  root.innerHTML = `
    <div class="screen" data-activity="${act.id}">
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <h1 data-ref="title"></h1>
        <button class="icon-btn" data-act="edit" aria-label="Rename or add notes">${icons.edit}</button>
        <button class="icon-btn" data-act="export" aria-label="Share">${icons.share}</button>
        <button class="icon-btn" data-act="delete" aria-label="Delete">${icons.trash}</button>
      </header>
      <div class="detail">
        <div class="detail-head">
          <span class="activity-badge">${act.icon}</span>
          <div class="meta" data-ref="meta"></div>
        </div>
        <div class="tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button role="tab" data-tab="${id}">${label}</button>`).join('')}
        </div>
        <div class="tab-panel" role="tabpanel"></div>
      </div>
    </div>`;
  const panel = root.querySelector('.tab-panel');
  const renderHead = () => {
    root.querySelector('[data-ref="title"]').textContent = w.name;
    root.querySelector('[data-ref="meta"]').innerHTML = `${formatDate(w.startedAt)}<br>${formatClock(w.startedAt)} – ${formatClock(w.endedAt)}`;
  };
  renderHead();

  async function showTab(id) {
    tab = id;
    history.replaceState(null, '', `#/workout/${encodeURIComponent(w.id)}?tab=${id}`);
    root.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
    disposeTab?.();
    disposeTab = null;
    panel.replaceChildren();
    panel.classList.toggle('fill', id === 'map' || id === '3d');
    panel.scrollTop = 0;
    if (id === 'summary') renderSummary(panel, w, track, units);
    else if (id === 'splits') renderSplits(panel, w, track, units, preferSpeed);
    else {
      panel.innerHTML = '<div class="saving-overlay"><div class="spinner"></div></div>';
      try {
        if (id === 'map') {
          const { mountMapView } = await import('../map/mapView.js');
          if (tab !== id) return;
          disposeTab = mountMapView(panel, {
            workout: w,
            track,
            units,
            styleId: s.mapStyle,
            preferSpeed,
            onStyleChange: (styleId) => updateSettings({ mapStyle: styleId }),
          });
        } else {
          const { mountView3D } = await import('../view3d/view3d.js');
          if (tab !== id) return;
          disposeTab = mountView3D(panel, {
            workout: w,
            track,
            units,
            exaggeration: s.exaggeration,
            satellite: settings().satellite3d,
            onSatelliteChange: (on) => updateSettings({ satellite3d: on }),
          });
        }
      } catch (e) {
        console.error(e);
        panel.innerHTML = `<div class="empty">${icons.warning}<div>Could not display this view.<br><small>${escapeHtml(e?.message ?? e)}</small></div></div>`;
      }
    }
  }
  d.add(() => disposeTab?.());

  root.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));

  const back = () => {
    if (history.length > 1) history.back();
    else navigate('/history', { replace: true });
    return true;
  };
  root.querySelector('[data-act="back"]').addEventListener('click', back);
  ctx.setBackHandler(back);

  root.querySelector('[data-act="edit"]').addEventListener('click', async () => {
    const result = await openDialog((dlg, close) => {
      dlg.innerHTML = `
        <h2>Edit workout</h2>
        <label class="field"><span>Name</span><input type="text" maxlength="80" autofocus /></label>
        <label class="field"><span>Notes</span><textarea maxlength="2000"></textarea></label>
        <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Save</button></div>`;
      const input = dlg.querySelector('input');
      const notes = dlg.querySelector('textarea');
      input.value = w.name;
      notes.value = w.notes ?? '';
      dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-v="save"]').addEventListener('click', () => close({ name: input.value.trim() || w.name, notes: notes.value.trim() }));
    });
    if (!result) return;
    w = await updateWorkout(w.id, result);
    renderHead();
    if (tab === 'summary') showTab('summary');
    window.dispatchEvent(new CustomEvent('workouts-changed'));
  });

  root.querySelector('[data-act="export"]').addEventListener('click', async () => {
    const cal = estimateCalories(track, w.activity, settings().profile, w.startedAt);
    const message = workoutShareText(w, { units, calories: cal?.kcal });
    const fmt = await openDialog((dlg, close) => {
      dlg.innerHTML = `<h2>Share</h2>
        <div class="share-preview" aria-label="Message preview"></div>
        <div class="share-actions">
          <button class="btn primary" data-v="sms">${icons.message}Text message</button>
          <button class="btn ghost" data-v="text">${icons.share}Other apps</button>
        </div>
        <div class="section-title">Export file</div>
        <div class="option-list"></div>
        <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button></div>`;
      dlg.querySelector('.share-preview').textContent = message;
      dlg.querySelectorAll('[data-v]').forEach((b) => b.addEventListener('click', () => close(b.dataset.v === 'cancel' ? null : b.dataset.v)));
      const list = dlg.querySelector('.option-list');
      for (const f of EXPORT_FORMATS) {
        const b = el(`<button><span class="tag">${f.label}</span><span>${f.label}<small>${f.description}</small></span></button>`);
        b.addEventListener('click', () => close(f.id));
        list.appendChild(b);
      }
    });
    if (!fmt) return;
    if (fmt === 'sms') {
      openSms(smsUri(message));
      return;
    }
    if (fmt === 'text') {
      try {
        if ((await shareText({ text: message, title: w.name })) === 'copied') toast('Workout summary copied');
      } catch (e) {
        toast(`Sharing failed: ${e?.message ?? e}`);
      }
      return;
    }
    try {
      const out = renderExport(fmt, w, track, { profile: settings().profile });
      await shareFile({ filename: out.filename, content: out.content, mime: out.mime, title: w.name });
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e?.message ?? e}`);
    }
  });

  root.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Delete workout?', message: `“${w.name}” will be permanently removed from this device.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await deleteWorkout(w.id);
    window.dispatchEvent(new CustomEvent('workouts-changed'));
    toast('Workout deleted');
    navigate('/history', { replace: true });
  });

  await showTab(tab);
  return () => d.dispose();
}

// ---- Summary ------------------------------------------------------------------------------

function statHTML(label, value, unit = '', cls = '') {
  return `<div class="stat ${cls}"><label>${label}</label><div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
}

function renderSummary(panel, w, track, units) {
  const sm = w.summary;
  const alt = (m) => (m == null ? '–' : Math.round(altitudeValue(m, units)).toLocaleString());
  const au = altitudeUnit(units);
  const pace = formatPace(sm.avgMovingSpeed, units, false);
  const rows = [
    statHTML('Distance', distanceValue(sm.distance, units).toFixed(2), distanceUnit(units), 'feature'),
    statHTML('Time', formatDuration(sm.duration)),
    statHTML('Moving time', formatDuration(sm.movingTime)),
    statHTML('Avg speed', speedValue(sm.avgMovingSpeed, units).toFixed(1), speedUnit(units)),
    statHTML('Avg pace', pace, paceUnit(units)),
    statHTML('Max speed', speedValue(sm.maxSpeed, units).toFixed(1), speedUnit(units)),
    statHTML('Stationary', formatDuration(sm.stationaryTime)),
    statHTML('Climb', `+${alt(sm.elevGain)}`, au),
    statHTML('Descent', `−${alt(sm.elevLoss)}`, au),
    statHTML('Net vertical', `${sm.netVertical >= 0 ? '+' : '−'}${alt(Math.abs(sm.netVertical))}`, au),
    statHTML('Min altitude', alt(sm.minAlt), au),
    statHTML('Max altitude', alt(sm.maxAlt), au),
    statHTML('Overall avg', speedValue(sm.avgSpeed, units).toFixed(1), speedUnit(units)),
  ];
  if (sm.ski) {
    rows.push(
      statHTML('Ski runs', String(sm.ski.runs)),
      statHTML('Lifts', String(sm.ski.lifts)),
      statHTML('Ski vertical', alt(sm.ski.descentVertical), au),
      statHTML('Lift time', formatDuration(sm.ski.liftSeconds)),
      statHTML('Max run speed', speedValue(sm.ski.maxRunSpeed, units).toFixed(1), speedUnit(units))
    );
  }
  panel.innerHTML = `
    <div class="page">
      <div class="stat-grid num" style="margin-top:12px">${rows.join('')}</div>
      ${effortHTML(w, track)}
      <div class="card mini-profile">${miniProfileSVG(track)}</div>
      ${w.notes ? `<div class="card notes">${escapeHtml(w.notes)}</div>` : ''}
      <p class="about">Altitude source: ${sm.hasBarometer ? 'barometer anchored to GPS' : 'GPS only'} · ${sm.pointCount.toLocaleString()} points${sm.segments > 1 ? ` · ${sm.segments} segments` : ''}${w.device ? ` · ${escapeHtml(w.device)}` : ''}</p>
    </div>`;
}

/** Heart rate, calories, cardio load and time in zones. */
function effortHTML(w, track) {
  const profile = settings().profile;
  const sm = w.summary;
  const hr = sm.heartRate;
  const complete = profileComplete(profile);
  const cal = estimateCalories(track, w.activity, profile, w.startedAt);
  const load = hr ? trimp(track, profile, w.startedAt) : null;
  const zones = hr ? zoneSeconds(track, profile, w.startedAt) : null;
  const tiles = [];
  if (hr) {
    tiles.push(statHTML('Avg heart rate', Math.round(hr.avg), 'bpm'));
    if (hr.max) tiles.push(statHTML('Max heart rate', Math.round(hr.max), 'bpm'));
  }
  if (cal) tiles.push(statHTML(cal.method === 'activity' ? 'Calories (est.)' : 'Calories', Math.round(cal.kcal).toLocaleString(), 'kcal'));
  if (load != null) tiles.push(statHTML('Cardio load', Math.round(load), loadLabel(load)));
  const hint = !complete
    ? `<p class="effort-hint">Add your sex, birth year and weight in <a href="#/settings">Settings → Profile</a> to estimate calories${hr ? ', heart-rate zones and cardio load' : ''}.</p>`
    : '';
  if (!tiles.length && !hint) return '';
  let zoneBlock = '';
  const total = zones ? zones.slice(1).reduce((a, b) => a + b, 0) : 0;
  if (zones && total > 0) {
    zoneBlock = `
      <div class="card zones">
        <div class="zones-title">Time in heart-rate zones</div>
        ${ZONES.slice()
          .reverse()
          .map((z) => {
            const secs = zones[z.id];
            const pct = (secs / total) * 100;
            return `<div class="zone-row"><span class="zone-name">Z${z.id} ${z.label}</span>
              <span class="zone-bar"><i style="width:${Math.max(pct > 0 ? 2 : 0, pct).toFixed(1)}%;background:${z.color}"></i></span>
              <span class="zone-time num">${formatDuration(Math.round(secs))}</span></div>`;
          })
          .join('')}
      </div>`;
  }
  return `
    ${tiles.length ? `<div class="section-title">Effort</div><div class="stat-grid num">${tiles.join('')}</div>` : ''}
    ${zoneBlock}
    ${hint}
    ${cal || load != null ? '<p class="about">Calories use the Keytel (2005) heart-rate equation, or activity, speed and slope when heart rate is missing. Cardio load is Banister TRIMP. Both are estimates.</p>' : ''}`;
}

function miniProfileSVG(track) {
  const W = 300;
  const H = 74;
  if (track.n < 2) return '';
  const total = track.dist[track.n - 1] || 1;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < track.n; i++) {
    const a = track.alt[i];
    if (Number.isFinite(a)) {
      lo = Math.min(lo, a);
      hi = Math.max(hi, a);
    }
  }
  if (!Number.isFinite(lo)) return '';
  const span = Math.max(10, hi - lo);
  const step = Math.max(1, Math.floor(track.n / 300));
  const pts = [];
  for (let i = 0; i < track.n; i += step) pts.push(`${((track.dist[i] / total) * W).toFixed(1)},${(H - 4 - ((track.alt[i] - lo) / span) * (H - 10)).toFixed(1)}`);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">
    <polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="var(--accent)" opacity="0.18"/>
    <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

// ---- Splits -------------------------------------------------------------------------------

function renderSplits(panel, w, track, units, preferSpeed) {
  const splitLen = splitLength(units);
  const splits = computeSplits(track, splitLen, w.summary.hasBarometer);
  if (!splits.length) {
    panel.innerHTML = '<div class="empty">No splits for this workout.</div>';
    return;
  }
  const full = splits.filter((sp) => !sp.partial);
  const speeds = (full.length ? full : splits).map((sp) => sp.avgSpeed);
  const fastest = Math.max(...speeds);
  const slowest = Math.min(...speeds);
  const au = altitudeUnit(units);
  const unit = distanceUnit(units);
  const withHr = splits.some((sp) => sp.avgHr != null);
  panel.innerHTML = `
    <div class="page">
      <table class="splits-table">
        <thead><tr><th>${unit}</th><th>${preferSpeed ? speedUnit(units) : `Pace ${paceUnit(units)}`}</th><th>Elev ${au}</th>${withHr ? '<th>♥</th>' : ''}<th></th><th>Time</th></tr></thead>
        <tbody>
          ${splits
            .map((sp) => {
              const label = sp.partial ? distanceValue(sp.distance, units).toFixed(2) : String(sp.index);
              const perf = preferSpeed ? speedValue(sp.avgSpeed, units).toFixed(1) : formatPace(sp.avgSpeed, units, false);
              const elev = Math.round(altitudeValue(sp.elevChange, units));
              const width = fastest > 0 ? Math.max(6, (sp.avgSpeed / fastest) * 100) : 0;
              const cls = !sp.partial && full.length > 1 ? (sp.avgSpeed === fastest ? 'fast' : sp.avgSpeed === slowest ? 'slow' : '') : '';
              return `<tr class="${sp.partial ? 'partial' : ''}">
                <td>${label}</td><td>${perf}</td><td>${elev > 0 ? '+' : ''}${elev}</td>${withHr ? `<td>${sp.avgHr != null ? Math.round(sp.avgHr) : '–'}</td>` : ''}
                <td class="bar-cell"><div class="split-bar ${cls}" style="width:${width}%"></div></td>
                <td>${formatDuration(Math.round(sp.time))}</td></tr>`;
            })
            .join('')}
        </tbody>
      </table>
      <p class="about">Splits use moving and stationary time but exclude manual pauses. Elevation is net change per split.</p>
    </div>`;
}

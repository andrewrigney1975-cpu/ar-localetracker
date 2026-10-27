import { ACTIVITIES, ACTIVITY_IDS, activity as activityProfile } from '../activities.js';
import { deleteWorkout, getTrack, getWorkout, updateWorkout } from '../db/workouts.js';
import { EXPORT_FORMATS, renderExport } from '../export/index.js';
import { getRoutineModel, rebuildRoutineModel } from '../insights/model.js';
import { assignWorkout, displayName, isUsable, routineChoices, routineOf } from '../insights/routines.js';
import { navigate } from '../router.js';
import { workoutShareText, smsUri } from '../export/text.js';
import { changeActivity } from '../services/workoutService.js';
import { lookupWeather, needsWeather } from '../services/weather.js';
import { weatherText } from '../weather/weather.js';
import { COURSE_MIME, courseFilename, initialsOf, parseCourse, toCourseGPX } from '../course/courseFile.js';
import { courseLinkURL } from '../course/courseLink.js';
import { openSms, shareFile, shareText } from '../services/share.js';
import { settings, updateSettings } from '../settings.js';
import { estimateCalories, loadLabel, profileComplete, trimp, ZONES, zoneSeconds } from '../stats/physio.js';
import { rejectedText, VO2_ACTIVITIES, workoutVo2max } from '../stats/vo2max.js';
import { significantExtremes } from '../stats/extremes.js';
import { boutsRun, intervalTotals } from '../stats/hii.js';
import { HII_LABELS } from '../hii/plan.js';
import { computeSplits, maxSustainedSpeed } from '../stats/summary.js';
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
        <button class="icon-btn" data-act="edit" aria-label="Edit name, activity or notes">${icons.edit}</button>
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
    if (id === 'summary') {
      renderSummary(panel, w, track, units);
      fillRoutinePicker();
      // Not looked up yet (recorded offline, or just saved): fetch it now and show it.
      if (s.weather && needsWeather(w)) {
        lookupWeather(w)
          .then((updated) => {
            if (!updated) return;
            w = updated;
            const slot = panel.querySelector('[data-ref="weather"]');
            const note = panel.querySelector('[data-ref="weather-note"]');
            if (tab === 'summary' && slot) slot.outerHTML = weatherHTML(w, units);
            if (tab === 'summary' && note) note.outerHTML = weatherNoteHTML(w);
          })
          .catch((e) => console.warn('Weather lookup failed', e));
      }
    }
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
            smooth: settings().smooth3d,
            onSmoothChange: (on) => updateSettings({ smooth3d: on }),
          });
        }
      } catch (e) {
        console.error(e);
        panel.innerHTML = `<div class="empty">${icons.warning}<div>Could not display this view.<br><small>${escapeHtml(e?.message ?? e)}</small></div></div>`;
      }
    }
  }
  d.add(() => disposeTab?.());

  // Routine picker on the Distance tile: the routine this workout was recognised as (or
  // none), to leave as it is, take it out of, or swap for another of the same activity.
  async function fillRoutinePicker() {
    const select = panel.querySelector('[data-ref="routine"]');
    if (!select || !isUsable(w)) return;
    let model;
    try {
      model = await getRoutineModel();
    } catch (e) {
      console.error(e);
      return;
    }
    const choices = routineChoices(model, w.activity);
    const current = routineOf(model, w);
    if (!choices.length || !select.isConnected) return;
    select.innerHTML = [
      `<option value="">No routine</option>`,
      ...choices.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(displayName(r.name))}</option>`),
    ].join('');
    select.value = current?.id ?? '';
    select.hidden = false;
    select.onchange = async () => {
      const routineId = select.value || null;
      const picked = choices.find((r) => r.id === routineId);
      select.disabled = true;
      try {
        await updateSettings({ routines: assignWorkout(settings().routines, model, w, routineId) });
        await rebuildRoutineModel();
        // The rebuild may rename the workout after its new routine (routineLabels).
        w = (await getWorkout(w.id)) ?? w;
        renderHead();
        toast(picked ? `Added to “${displayName(picked.name)}”` : 'Taken out of its routine');
      } catch (e) {
        console.error(e);
        toast(`Could not change the routine: ${e?.message ?? e}`);
      }
      if (tab === 'summary') fillRoutinePicker();
      select.disabled = false;
    };
  }

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
        <div class="field"><span>Activity</span>
          <div class="chip-row" role="radiogroup" aria-label="Activity">
            ${ACTIVITY_IDS.map((id) => `<button class="chip" role="radio" data-a="${id}" data-activity="${id}">${ACTIVITIES[id].icon}${ACTIVITIES[id].label}</button>`).join('')}
          </div>
        </div>
        <p class="field-hint" data-ref="activity-hint" hidden>The workout will be re-processed as a <b></b>. Distance and times may change slightly.</p>
        <label class="field"><span>Notes</span><textarea maxlength="2000"></textarea></label>
        <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Save</button></div>`;
      const input = dlg.querySelector('input');
      const notes = dlg.querySelector('textarea');
      const hint = dlg.querySelector('[data-ref="activity-hint"]');
      let picked = w.activity;
      const pick = (id) => {
        picked = id;
        dlg.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.a === id)));
        hint.hidden = id === w.activity;
        hint.querySelector('b').textContent = ACTIVITIES[id].label.toLowerCase();
      };
      dlg.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => pick(b.dataset.a)));
      pick(w.activity);
      input.value = w.name;
      notes.value = w.notes ?? '';
      dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
      dlg.querySelector('[data-v="save"]').addEventListener('click', () => close({ name: input.value.trim() || w.name, notes: notes.value.trim(), activity: picked }));
    });
    if (!result) return;
    const { activity: nextActivity, ...patch } = result;
    // A name the user typed replaces the routine's label for good (see routineLabels).
    if (patch.name !== w.name) patch.routineLabel = null;
    if (nextActivity !== w.activity) {
      // Untouched name: let changeActivity rename a default one ("Morning Walk" → "Morning Run").
      if (patch.name === w.name) delete patch.name;
      try {
        w = await changeActivity(w, nextActivity);
      } catch (e) {
        console.error(e);
        toast(`Could not change the activity: ${e?.message ?? e}`);
        return;
      }
      // The whole view depends on the activity (colours, speed vs pace, ski stats).
      w = await updateWorkout(w.id, patch);
      window.dispatchEvent(new CustomEvent('workouts-changed'));
      toast(`Changed to ${ACTIVITIES[nextActivity].label.toLowerCase()}`);
      navigate(`/workout/${encodeURIComponent(w.id)}?tab=${tab}`, { replace: true });
      return;
    }
    w = await updateWorkout(w.id, patch);
    renderHead();
    if (tab === 'summary') showTab('summary');
    window.dispatchEvent(new CustomEvent('workouts-changed'));
  });

  root.querySelector('[data-act="export"]').addEventListener('click', async () => {
    const cal = estimateCalories(track, w.activity, settings().profile, w.startedAt);
    const message = workoutShareText(w, { units, calories: cal?.kcal });
    let hideEnds = false;
    const fmt = await openDialog((dlg, close) => {
      dlg.innerHTML = `<h2>Share</h2>
        <div class="share-preview" aria-label="Message preview"></div>
        <div class="share-actions">
          <button class="btn primary" data-v="sms">${icons.message}Text message</button>
          <button class="btn ghost" data-v="text">${icons.share}Other apps</button>
        </div>
        <div class="section-title">Share course</div>
        <p class="share-course-note">The route and its altitude, for someone to explore in Locale's View, in a web browser or in another map app. No times, speeds or heart rate.</p>
        <label class="share-hide"><span>Hide start and finish<small>Leaves out the first and last 200 m</small></span><input type="checkbox" class="switch" data-hide /></label>
        <button class="btn ghost course-btn" data-v="course">${icons.route}<span data-ref="course-name"></span></button>
        <button class="btn ghost course-btn" data-v="course-link">${icons.share}<span>Share a link to view in a browser</span></button>
        <div class="section-title">Export file</div>
        <div class="option-list"></div>
        <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button></div>`;
      dlg.querySelector('.share-preview').textContent = message;
      const initials = initialsOf(settings().profile.name);
      dlg.querySelector('[data-ref="course-name"]').textContent = initials ? `Share ${courseFilename(initials, w.name)}` : 'Share course';
      dlg.querySelector('[data-hide]').addEventListener('change', (e) => {
        hideEnds = e.target.checked;
      });
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
    if (fmt === 'course') {
      await shareCourse(w, track, { hideEnds });
      return;
    }
    if (fmt === 'course-link') {
      await shareCourseLink(w, track, { hideEnds });
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

// ---- Share course -------------------------------------------------------------------------

/** Ask once for the user's name (its initials label shared courses); null if cancelled. */
async function askName() {
  const name = await openDialog((dlg, close) => {
    dlg.innerHTML = `
      <h2>Your name</h2>
      <p>Shared courses are labelled with your initials, like "AR Bondi loop". Only the initials are sent.</p>
      <label class="field"><span>Name</span><input type="text" maxlength="60" autocomplete="name" placeholder="First Last" autofocus /></label>
      <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Continue</button></div>`;
    const input = dlg.querySelector('input');
    dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
    dlg.querySelector('[data-v="save"]').addEventListener('click', () => close(input.value.trim()));
  });
  if (!name) return null;
  await updateSettings({ profile: { ...settings().profile, name } });
  return name;
}

async function shareCourse(w, track, { hideEnds }) {
  const name = settings().profile.name || (await askName());
  if (!name) return;
  const initials = initialsOf(name);
  try {
    const out = toCourseGPX(w, track, { initials, hideEnds });
    await shareFile({ filename: courseFilename(initials, w.name), content: out.text, mime: COURSE_MIME, title: w.name });
  } catch (e) {
    console.error(e);
    toast(`Sharing failed: ${e?.message ?? e}`);
  }
}

/** Share the course as a Locale Viewer link, which opens in any browser. */
async function shareCourseLink(w, track, { hideEnds }) {
  const name = settings().profile.name || (await askName());
  if (!name) return;
  try {
    const course = parseCourse(toCourseGPX(w, track, { initials: initialsOf(name), hideEnds }).text);
    const url = await courseLinkURL(course);
    if (!url) {
      toast('This course is too detailed for a link. Share the .gpx file instead.', 4000);
      return;
    }
    if ((await shareText({ text: `${w.name}: ${url}`, title: w.name })) === 'copied') toast('Course link copied');
  } catch (e) {
    console.error(e);
    toast(`Sharing failed: ${e?.message ?? e}`);
  }
}

// ---- Summary ------------------------------------------------------------------------------

function statHTML(label, value, unit = '', cls = '') {
  return `<div class="stat ${cls}"><label>${label}</label><div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div></div>`;
}

/** Average horizontal accuracy of the kept GPS fixes ("GPS ±8 m avg"), or '' without it. */
function gpsErrorHTML(track, units) {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < (track?.n ?? 0); i++) {
    const a = track.acc[i];
    if (Number.isFinite(a) && a > 0) {
      sum += a;
      n++;
    }
  }
  if (!n) return '';
  const v = Math.round(altitudeValue(sum / n, units));
  return `<span class="gps-error" title="Average accuracy the phone reported for this workout's GPS fixes">GPS ±${v} ${altitudeUnit(units)} avg</span>`;
}

function renderSummary(panel, w, track, units) {
  const sm = w.summary;
  const alt = (m) => (m == null ? '–' : Math.round(altitudeValue(m, units)).toLocaleString());
  const au = altitudeUnit(units);
  const pace = formatPace(sm.avgMovingSpeed, units, false);
  // Best 30 s average from the track, so workouts saved with the old instantaneous max show it too.
  const top = track?.n ? maxSustainedSpeed(track) : sm.maxSpeed;
  const rows = [
    `<div class="stat feature distance-tile"><div class="distance-main">${statHTML('Distance', distanceValue(sm.distance, units).toFixed(2), distanceUnit(units), 'bare')}${gpsErrorHTML(track, units)}</div><select class="select routine-pick" data-ref="routine" aria-label="Routine" hidden></select></div>`,
    statHTML('Time', formatDuration(sm.duration)),
    statHTML('Moving time', formatDuration(sm.movingTime)),
    statHTML('Avg speed', speedValue(sm.avgMovingSpeed, units).toFixed(1), speedUnit(units)),
    statHTML('Avg pace', pace, paceUnit(units)),
    statHTML('Max speed', speedValue(top, units).toFixed(1), speedUnit(units)),
    statHTML('Best pace', formatPace(top, units, false), paceUnit(units)),
    statHTML('Stationary', formatDuration(sm.stationaryTime)),
    statHTML('Climb', `+${alt(sm.elevGain)}`, au),
    statHTML('Descent', `−${alt(sm.elevLoss)}`, au),
    statHTML('Net vertical', `${sm.netVertical >= 0 ? '+' : '−'}${alt(Math.abs(sm.netVertical))}`, au),
    statHTML('Min altitude', alt(sm.minAlt), au),
    statHTML('Max altitude', alt(sm.maxAlt), au),
    statHTML('Overall avg', speedValue(sm.avgSpeed, units).toFixed(1), speedUnit(units)),
  ];
  // Steps per minute while moving; the phone's step counter fills in when the watch has none.
  if (sm.cadence) rows.push(statHTML('Avg cadence', Math.round(sm.cadence.avg), sm.cadence.source === 'phone' ? 'spm · phone' : sm.cadence.source === 'mixed' ? 'spm · watch + phone' : 'spm'));
  if (sm.ski) {
    rows.push(
      statHTML('Ski runs', String(sm.ski.runs)),
      statHTML('Lifts', String(sm.ski.lifts)),
      statHTML('Ski vertical', alt(sm.ski.descentVertical), au),
      statHTML('Lift time', formatDuration(sm.ski.liftSeconds)),
      statHTML('Max run speed', speedValue(sm.ski.maxRunSpeed, units).toFixed(1), speedUnit(units))
    );
  }
  const effort = effortHTML(w, track);
  const bouts = w.hii?.length ? boutsRun(w.hii, track, w.activeIntervals ?? []) : [];
  panel.innerHTML = `
    <div class="page">
      <div class="stat-grid num" style="margin-top:12px">${rows.join('')}</div>
      ${goalHTML(w, units)}
      ${intervalsHTML(w, bouts, units)}
      ${effort.html}
      ${weatherHTML(w, units)}
      <div class="card mini-profile">${miniProfileHTML(track, units, bouts)}</div>
      ${effort.notes}
      ${weatherNoteHTML(w)}
      ${w.notes ? `<div class="card notes">${escapeHtml(w.notes)}</div>` : ''}
      <p class="about">Altitude source: ${sm.hasBarometer ? 'barometer anchored to GPS' : 'GPS only'} · ${sm.pointCount.toLocaleString()} points${sm.segments > 1 ? ` · ${sm.segments} segments` : ''}${w.device ? ` · ${escapeHtml(w.device)}` : ''}</p>
    </div>`;
}

/**
 * High-intensity intervals as run: a tile per mode with its average pace (or speed) and its
 * time over how many bouts, so it shows whether the sprints were sprints.
 */
function intervalsHTML(w, bouts, units) {
  const totals = intervalTotals(bouts);
  if (!totals.length) return '';
  const pace = (settings().liveSpeedMode[w.activity] ?? activityProfile(w.activity).liveSpeedMode) === 'pace';
  const tiles = totals.map((t) => {
    const value = pace ? formatPace(t.speed, units, false) : speedValue(t.speed, units).toFixed(1);
    return `<div class="stat hii-stat" data-mode="${t.mode}"><label>${HII_LABELS[t.mode]}</label><div class="value">${value}<small>${pace ? paceUnit(units) : speedUnit(units)}</small></div>
      <small class="stat-note">${formatDuration(Math.round(t.seconds))} in ${t.bouts} bout${t.bouts === 1 ? '' : 's'}</small></div>`;
  });
  const p = w.hii[w.hii.length - 1];
  const ran = totals.reduce((s, t) => s + t.seconds, 0);
  const planned = w.hii.reduce((s, x) => s + x.durationS, 0);
  const how = [w.hii.some((x) => x.stopS != null) ? 'turned off part-way' : '', ran < planned && p.stopS == null ? 'the workout ended first' : ''].filter(Boolean).join('; ');
  return `<div class="section-title">Intervals</div>
    <div class="stat-grid num">${tiles.join('')}</div>
    <p class="about">${formatDuration(Math.round(ran))} of intervals at ${['walk', 'jog', 'run', 'sprint'].map((m) => `${HII_LABELS[m].toLowerCase()} ${p.shares[m]}%`).join(', ')}${how ? ` (${how})` : ''}. Bands on the elevation chart show each bout.</p>`;
}

/** Weather at the start (services/weather.js): conditions, temperature, feels like and wind. */
function weatherHTML(w, units) {
  const t = weatherText(w.weather, units);
  if (!t) return '<div data-ref="weather" hidden></div>';
  const tile = (label, value, side = '') =>
    `<div class="stat"><label>${label}</label><div class="value">${escapeHtml(value)}</div>${side ? `<small class="stat-note">${side}</small>` : ''}</div>`;
  return `<div data-ref="weather" class="weather">
      <div class="section-title">Weather at the start</div>
      <div class="stat-grid num">
        ${tile('Conditions', t.condition)}
        ${tile('Temperature', t.temp, t.feels ? `Feels like ${t.feels}` : '')}
        ${tile('Wind', t.wind, t.gusts ? `Gusts ${t.gusts}` : '')}
      </div>
    </div>`;
}

const WEATHER_SOURCES = {
  forecast: 'the weather models Open-Meteo gathers from national weather services',
  historical: "Open-Meteo's archive of those weather services' model runs",
  archive: 'the ERA5 reanalysis (ECMWF), a reconstruction of past weather from observations',
};

/** Why the weather is recorded and where it comes from, under the notes on effort. */
function weatherNoteHTML(w) {
  const wx = w.weather;
  if (!wx || wx.unavailable) return '<p data-ref="weather-note" hidden></p>';
  return `<p class="about" data-ref="weather-note">Weather is recorded because heat, cold, wind and rain all change pace and heart rate, so a slow day can be put in context.
    It's the hourly data for the start time and place, worked out for the minute you started, from ${WEATHER_SOURCES[wx.source] ?? 'Open-Meteo'}.
    That describes the area on a grid of a few kilometres, not a reading where you stood: shade, shelter and breezes off water can differ.
    Windy means wind of 30 km/h or more, or gusts of 50 km/h or more.
    <a href="https://open-meteo.com" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0).</p>`;
}

/** "Goal 4.7 km (auto, usual Saturday morning loop) · finished 4.72 km ✓" */
function goalHTML(w, units) {
  const p = w.prediction;
  if (!p?.goalM) return '';
  const unitM = units === 'imperial' ? 1609.344 : 1000;
  const goal = Math.round((p.goalM / unitM) * 100) / 100;
  const done = (w.summary.distance / unitM).toFixed(2);
  const hit = Math.abs(w.summary.distance - p.goalM) / p.goalM <= 0.1;
  const how = p.source === 'manual' ? 'set by you' : p.source === 'route' ? `auto, usual ${p.name ?? 'route'}` : `auto, ${p.name ?? 'usual time'}`;
  const result = p.offRoute ? 'left the usual route' : hit ? `finished ${done} ${distanceUnit(units)} ✓` : `finished ${done} ${distanceUnit(units)}`;
  return `<p class="goal-line">Goal ${goal} ${distanceUnit(units)} <span class="dim">(${escapeHtml(how)})</span> · ${result}</p>`;
}

/** Heart rate, calories, cardio load and time in zones. */
/** The Effort tiles and zones, and its notes on how calories, load and VO2max are worked out (shown under Weather). */
function effortHTML(w, track) {
  const profile = settings().profile;
  const sm = w.summary;
  const hr = sm.heartRate;
  const complete = profileComplete(profile);
  const cal = estimateCalories(track, w.activity, profile, w.startedAt);
  const load = hr ? trimp(track, profile, w.startedAt) : null;
  const zones = hr ? zoneSeconds(track, profile, w.startedAt) : null;
  const vo2 = hr && VO2_ACTIVITIES.includes(w.activity) ? workoutVo2max(track, w.activity, profile, w.startedAt) : null;
  const tiles = [];
  if (hr) {
    tiles.push(statHTML('Avg heart rate', Math.round(hr.avg), 'bpm'));
    if (hr.max) tiles.push(statHTML('Max heart rate', Math.round(hr.max), 'bpm'));
  }
  if (cal) tiles.push(statHTML(cal.method === 'activity' ? 'Calories (est.)' : 'Calories', Math.round(cal.kcal).toLocaleString(), 'kcal'));
  if (load != null) tiles.push(statHTML('Cardio load', Math.round(load), loadLabel(load)));
  if (vo2?.value != null) tiles.push(statHTML('VO2max (est.)', vo2.value.toFixed(1), 'ml/kg/min'));
  const hint = !complete
    ? `<p class="effort-hint">Add your sex, birth year and weight in <a href="#/you">You → Profile</a> to estimate calories${hr ? ', heart-rate zones and cardio load' : ''}.</p>`
    : '';
  if (!tiles.length && !hint) return { html: '', notes: '' };
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
  return {
    html: `
    ${tiles.length ? `<div class="section-title">Effort</div><div class="stat-grid num">${tiles.join('')}</div>` : ''}
    ${zoneBlock}
    ${hint}`,
    notes: `
    ${cal || load != null ? '<p class="about">Calories use the Keytel (2005) heart-rate equation, or activity, speed and slope when heart rate is missing. Cardio load is Banister TRIMP. Both are estimates.</p>' : ''}
    ${vo2 ? `<p class="about">${vo2AboutText(vo2)}</p>` : ''}`,
  };
}

/** How the VO2max estimate was made, or why there isn't one. */
function vo2AboutText(r) {
  const why = Object.keys(r.rejected).length ? ` Left out: ${escapeHtml(rejectedText(r.rejected))}.` : '';
  if (r.value != null) {
    return `VO2max uses the HUNT walking model (Loe 2016) on ${r.windows} of ${r.checked} steady 5-minute stretches (middle half ${r.low.toFixed(1)}–${r.high.toFixed(1)}), typically within about 14%.${why}`;
  }
  if (r.reason === 'profile') return 'Add your sex, birth year and weight in <a href="#/you">You → Profile</a> to estimate VO2max.';
  if (r.reason === 'no-steady') {
    return r.checked
      ? `No VO2max estimate: too few steady 5-minute stretches passed the heart-rate checks.${why}`
      : 'No VO2max estimate: it needs steady 5-minute stretches after a 10-minute warm-up.';
  }
  return '';
}

/**
 * Elevation chart for the Summary: the profile as a stretched SVG, with HTML labels (so the
 * text isn't stretched) on the significant highs and lows (stats/extremes.js). Labels of the
 * same kind that would overlap keep the one with the bigger swing.
 */
function miniProfileHTML(track, units, bouts = []) {
  const W = 300;
  const H = 100;
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
  const x = (i) => (track.dist[i] / total) * W;
  const y = (a) => 4 + (1 - (a - lo) / span) * (H - 8);
  const step = Math.max(1, Math.floor(track.n / 300));
  const pts = [];
  for (let i = 0; i < track.n; i += step) if (Number.isFinite(track.alt[i])) pts.push(`${x(i).toFixed(1)},${y(track.alt[i]).toFixed(1)}`);
  const placed = [];
  for (const e of significantExtremes(track.dist, track.alt, track.n).sort((a, b) => b.swing - a.swing)) {
    const px = (x(e.i) / W) * 100;
    if (placed.some((p) => p.type === e.type && Math.abs(p.px - px) < 16)) continue;
    placed.push({ ...e, px, py: (y(e.alt) / H) * 100 });
  }
  const labels = placed
    .map((p) => {
      // Keep the text inside the card at either end.
      const align = p.px < 8 ? 'start' : p.px > 92 ? 'end' : 'mid';
      return `<span class="ele-mark ${p.type} ${align}" style="left:${p.px.toFixed(2)}%;top:${p.py.toFixed(2)}%"><b class="num">${(Math.round(altitudeValue(p.alt, units)) || 0).toLocaleString().replace('-', '−')} ${altitudeUnit(units)}</b></span>`;
    })
    .join('');
  // Interval bouts as bands behind the profile.
  const bands = bouts
    .map((b) => `<rect class="hii-band ${b.mode}" x="${((b.fromM / total) * W).toFixed(2)}" y="0" width="${Math.max(0.3, ((b.toM - b.fromM) / total) * W).toFixed(2)}" height="${H}"/>`)
    .join('');
  return `<div class="ele-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Elevation profile">
        ${bands}
        <polygon points="0,${H} ${pts.join(' ')} ${W},${H}" fill="var(--accent)" opacity="0.18"/>
        <polyline points="${pts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      </svg>
      ${labels}
    </div>`;
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

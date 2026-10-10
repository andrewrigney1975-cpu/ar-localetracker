import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { maxHeartRate } from '../stats/physio.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { App } from '@capacitor/app';
import { INTERVAL_OPTIONS, spokenAverage, spokenDistance } from '../voice/coach.js';
import { getRoutineModel, rebuildRoutineModel } from '../insights/model.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';

const GOAL_MODES = ['auto', 'set', 'off'];
const GOAL_LABELS = { auto: 'Auto goal', set: 'Set goal', off: 'Goal' };
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clock = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** "Sat", "Tue & Thu", "Mon, Wed & Fri": the days a routine is usually done on. */
function usualDays(weekdays) {
  const total = weekdays.reduce((a, b) => a + b, 0);
  const days = weekdays.map((n, d) => [n, d]).filter(([n]) => n >= total * 0.2).map(([, d]) => DAY_SHORT[d]);
  if (!days.length) return 'any day';
  return days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} & ${days[days.length - 1]}`;
}

function routinesHTML(model, s) {
  const imperial = s.units === 'imperial';
  const unit = imperial ? 'mi' : 'km';
  const rows = [];
  const learning = [];
  for (const id of ACTIVITY_IDS) {
    const a = model?.activities?.[id];
    if (s.voice.goalMode[id] !== 'auto') continue;
    if (!a?.ready) {
      learning.push(`${ACTIVITIES[id].label}: ${a?.usable ?? 0} of ${model?.need ?? 5}`);
      continue;
    }
    for (const r of a.routines.filter((x) => x.eligible || x.suppressed)) {
      const goal = Math.round((r.goal[imperial ? 'imperial' : 'metric'] / (imperial ? 1609.344 : 1000)) * 10) / 10;
      const hit = r.predictions ? ` · goal hit ${r.hits} of ${r.predictions}` : '';
      rows.push(`<div class="setting" data-activity="${id}"><span class="act-label">${ACTIVITIES[id].icon}<span class="text">${escapeHtml(r.name[0].toUpperCase() + r.name.slice(1))}
          <small>${goal} ${unit} · ${r.count} times · ${usualDays(r.weekdays)} ~${clock(r.startMin)}${hit}${r.suppressed ? ' · paused: recent goals missed' : ''}</small></span></span>
          <span class="voice-kinds"><button class="chip" data-rename="${escapeHtml(r.id)}">Rename</button><button class="chip" data-forget="${escapeHtml(r.id)}">Forget</button></span></div>`);
    }
  }
  const excluded = s.routines.excluded.length;
  return `
    <div class="section-title">Learned routines</div>
    <div class="card settings-group">
      ${rows.join('') || `<div class="setting"><div class="text">No routines yet<small>Locale learns once an activity has ${model?.need ?? 5} workouts in the last 6 months. Three similar workouts from the same place at about the same time of week make a routine, and it then sets the goal for you.</small></div></div>`}
      ${learning.length ? `<div class="setting"><div class="text">Still learning<small>${learning.join(' · ')} workouts</small></div></div>` : ''}
      ${excluded ? `<div class="setting"><div class="text">${excluded} workout${excluded === 1 ? '' : 's'} left out<small>From routines you asked Locale to forget</small></div><button class="btn ghost" data-act="unforget">Restore</button></div>` : ''}
    </div>`;
}

const MAP_STYLE_LABELS = { streets: 'Streets', light: 'Light', dark: 'Dark', topo: 'Topo' };

function segmented(name, options, value) {
  return `<div class="segmented" role="group" data-seg="${name}">
    ${options.map(([v, label]) => `<button data-v="${v}" aria-pressed="${String(v) === String(value)}">${label}</button>`).join('')}
  </div>`;
}

export async function mount(root) {
  const d = new Disposer();
  const render = async () => {
    const s = settings();
    const [caps, perms, workouts, watch, model] = await Promise.all([
      tracker.getCapabilities().catch(() => null),
      tracker.checkPermissions().catch(() => null),
      listWorkouts().catch(() => []),
      tracker.getWatchStatus().catch(() => null),
      getRoutineModel().catch(() => null),
    ]);
    const p = s.profile;
    const imperial = s.units === 'imperial';
    const weightShown = p.weightKg ? Math.round(imperial ? p.weightKg * 2.20462 : p.weightKg) : '';
    const estMax = maxHeartRate({ ...p, maxHr: null });
    const watchName = watch?.watches?.[0]?.name;
    const watchText = !watch?.supported
      ? 'Wear OS not available on this phone'
      : watchName
        ? `${escapeHtml(watchName)} · ${watch.connected ? 'connected' : 'not nearby'}`
        : 'Install Locale on your Wear OS watch';
    root.innerHTML = `
      <div class="screen">
        <header class="topbar"><h1>Settings</h1></header>
        <div class="body">
          <div class="page">
            <div class="section-title">Units &amp; display</div>
            <div class="card settings-group">
              <div class="setting"><div class="text">Units<small>${s.units === 'metric' ? 'Kilometres, metres, km/h' : 'Miles, feet, mph'}</small></div>
                ${segmented('units', [['metric', 'Metric'], ['imperial', 'Imperial']], s.units)}</div>
              <div class="setting"><div class="text">Theme</div>
                ${segmented('theme', [['system', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], s.theme)}</div>
              <label class="setting"><span class="text">Keep screen on<small>While the live workout screen is open</small></span>
                <input type="checkbox" class="switch" data-toggle="keepScreenOn" ${s.keepScreenOn ? 'checked' : ''} /></label>
            </div>

            <div class="section-title">Profile</div>
            <div class="card settings-group">
              <div class="setting"><div class="text">Sex<small>Used for calories and cardio load</small></div>
                ${segmented('profile.sex', [['male', 'Male'], ['female', 'Female']], p.sex)}</div>
              <label class="setting"><span class="text">Birth year</span>
                <input class="num-input" type="number" inputmode="numeric" min="1900" max="2025" data-profile="birthYear" value="${p.birthYear ?? ''}" placeholder="1985" /></label>
              <label class="setting"><span class="text">Weight</span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="decimal" min="20" max="300" step="0.5" data-profile="weight" value="${weightShown}" placeholder="${imperial ? '165' : '75'}" />${imperial ? 'lb' : 'kg'}</span></label>
              <label class="setting"><span class="text">Resting heart rate<small>Optional · default 60</small></span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="30" max="120" data-profile="restingHr" value="${p.restingHr ?? ''}" placeholder="60" />bpm</span></label>
              <label class="setting"><span class="text">Max heart rate<small>Optional · ${estMax ? `estimated ${estMax} from age` : 'estimated from age'}</small></span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="120" max="230" data-profile="maxHr" value="${p.maxHr ?? ''}" placeholder="${estMax ?? '185'}" />bpm</span></label>
            </div>

            <div class="section-title">Watch</div>
            <div class="card settings-group">
              <div class="setting"><div class="text">Wear OS watch<small>${watchText}</small></div>
                <span class="${watch?.connected ? 'status-ok' : 'status-bad'}">${watch?.connected ? 'Ready' : 'Offline'}</span></div>
              <div class="setting"><div class="text">Start from watch<small>${watch?.backgroundLocation ? 'Workouts can start from the watch while Locale is closed' : 'Needs location "Allow all the time". Without it, the watch asks you to tap a notification on the phone.'}</small></div>
                ${watch?.backgroundLocation ? '<span class="status-ok">Allowed</span>' : '<button class="btn ghost" data-act="bglocation">Allow</button>'}</div>
            </div>

            <div class="section-title">Home-screen widgets</div>
            <div class="card settings-group">
              ${[
                ['1x1', '1 × 1', 'Your last-used activity'],
                ['2x1', '2 × 1', 'Run and walk'],
                ['2x2', '2 × 2', 'Walk, run, cycle and ski'],
              ]
                .map(([size, label, desc]) => `<div class="setting"><div class="text">${label}<small>${desc}. One tap starts recording.</small></div>
                  <button class="btn ghost" data-widget="${size}">Add</button></div>`)
                .join('')}
            </div>

            <div class="section-title">Auto-pause</div>
            <div class="card settings-group">
              ${ACTIVITY_IDS.map((id) => {
                const a = ACTIVITIES[id];
                return `<label class="setting" data-activity="${id}"><span class="act-label">${a.icon}<span class="text">${a.label}<small>Pause when stopped for 5 s</small></span></span>
                  <input type="checkbox" class="switch" data-autopause="${id}" ${s.autoPause[id] ? 'checked' : ''} /></label>`;
              }).join('')}
            </div>

            <div class="section-title">Voice announcements</div>
            <div class="card settings-group">
              ${ACTIVITY_IDS.map((id) => {
                const a = ACTIVITIES[id];
                const chip = (kind, label) => `<button class="chip" data-voice="${kind}" data-activity="${id}" aria-pressed="${Boolean(s.voice[kind][id])}">${label}</button>`;
                const mode = s.voice.goalMode[id] ?? 'off';
                const goalChip = `<button class="chip goal-chip" data-goalmode="${id}" aria-pressed="${mode !== 'off'}" aria-label="Goal: ${mode}">${GOAL_LABELS[mode]}</button>`;
                return `<div class="setting" data-activity="${id}"><span class="act-label">${a.icon}<span class="text">${a.label}</span></span>
                  <span class="voice-kinds">${chip('splits', 'Splits')}${chip('time', 'Time')}${goalChip}</span></div>`;
              }).join('')}
              <div class="setting stack"><div class="text">Time announcements<small>Every few minutes of active time, with distance and average pace or speed</small></div>
                ${segmented('voice.intervalMin', INTERVAL_OPTIONS.map((m) => [m, `${m} min`]), s.voice.intervalMin)}</div>
              <div class="setting"><div class="text">Other audio<small>Music and podcasts while Locale speaks</small></div>
                ${segmented('voice.duck', [['true', 'Lower'], ['false', 'Pause']], String(s.voice.duck))}</div>
              <label class="setting"><span class="text">Say the goal at the start<small>For example "Goal 4.7 kilometres, your usual Saturday morning loop"</small></span>
                <input type="checkbox" class="switch" data-toggle="confirmGoal" ${s.voice.confirmGoal ? 'checked' : ''} /></label>
              <div class="setting"><div class="text">Splits every ${imperial ? 'mile' : 'kilometre'}; goal at 25, 50, 75 and 100%<small>Auto goal: learned from your usual routes and times. Set goal: the distance chosen on the start screen. Tap a goal chip to switch.</small></div>
                <button class="btn ghost" data-act="voicetest">Test</button></div>
            </div>

            ${routinesHTML(model, s)}

            <div class="section-title">Maps</div>
            <div class="card settings-group">
              <div class="setting stack"><div class="text">Map style</div>
                ${segmented('mapStyle', Object.entries(MAP_STYLE_LABELS), s.mapStyle)}</div>
              <div class="setting stack"><div class="text">3D vertical exaggeration<small>Auto fits the climb to the route size</small></div>
                ${segmented('exaggeration', [['auto', 'Auto'], ['2', '2×'], ['5', '5×'], ['10', '10×']], s.exaggeration)}</div>
              <label class="setting"><span class="text">Satellite in 3D<small>Show aerial imagery under the 3D route (needs a connection)</small></span>
                <input type="checkbox" class="switch" data-toggle="satellite3d" ${s.satellite3d ? 'checked' : ''} /></label>
              <label class="setting"><span class="text">Smooth 3D route<small>Draw the 3D route as a 10-second average (stats are unaffected)</small></span>
                <input type="checkbox" class="switch" data-toggle="smooth3d" ${s.smooth3d ? 'checked' : ''} /></label>
            </div>

            <div class="section-title">Tracking reliability</div>
            <div class="card settings-group">
              <div class="setting"><div class="text">Location permission<small>${perms?.location === 'granted' ? 'Precise location while using the app' : 'Not granted'}</small></div>
                <span class="${perms?.location === 'granted' ? 'status-ok' : 'status-bad'}">${perms?.location === 'granted' ? 'Allowed' : 'Needed'}</span></div>
              <div class="setting"><div class="text">Notifications<small>Shows controls on the lock screen during workouts</small></div>
                <span class="${perms?.notifications === 'granted' ? 'status-ok' : 'status-bad'}">${perms?.notifications === 'granted' ? 'Allowed' : 'Off'}</span></div>
              <div class="setting"><div class="text">Battery optimisation<small>${caps?.ignoringBatteryOptimizations ? 'Locale can run unrestricted in the background' : 'Android may pause tracking with the screen off'}</small></div>
                ${caps?.ignoringBatteryOptimizations ? '<span class="status-ok">Unrestricted</span>' : '<button class="btn ghost" data-act="battery">Allow</button>'}</div>
              <div class="setting"><div class="text">Sensors<small>${caps ? `Barometer: ${caps.barometer ? 'yes' : 'no'} · Compass: ${caps.compass ? 'yes' : 'no'}` : 'Unknown'}</small></div>
                <button class="btn ghost" data-act="appsettings">App settings</button></div>
            </div>

            <div class="about">
              <p><strong>Locale Exercise Tracker</strong> <span data-ref="version"></span><br>${workouts.length} workout${workouts.length === 1 ? '' : 's'} stored on this device.</p>
              <p>Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors. Tiles by <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a>, <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA). 3D satellite imagery © Esri, Maxar, Earthstar Geographics.</p>
              ${tracker.isNative ? '' : '<p>Running in the browser with simulated GPS. Add <code>?sim=10</code> to the URL to speed it up.</p>'}
            </div>
          </div>
        </div>
      </div>`;

    root.querySelectorAll('[data-seg]').forEach((group) =>
      group.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', async () => {
          const key = group.dataset.seg;
          if (key.startsWith('profile.')) await updateSettings({ profile: { ...settings().profile, [key.slice(8)]: b.dataset.v } });
          else if (key === 'voice.intervalMin') await updateSettings({ voice: { ...settings().voice, intervalMin: Number(b.dataset.v) } });
          else if (key === 'voice.duck') await updateSettings({ voice: { ...settings().voice, duck: b.dataset.v === 'true' } });
          else await updateSettings({ [key]: b.dataset.v });
          render();
        })
      )
    );
    root.querySelectorAll('[data-profile]').forEach((input) =>
      input.addEventListener('change', async () => {
        const raw = input.value.trim();
        let v = raw === '' ? null : Number(raw);
        if (v != null && (!Number.isFinite(v) || v < Number(input.min) || v > Number(input.max))) {
          toast(`Enter a value between ${input.min} and ${input.max}`);
          input.value = '';
          v = null;
        }
        const field = input.dataset.profile;
        const profile = { ...settings().profile };
        if (field === 'weight') profile.weightKg = v == null ? null : imperial ? Math.round((v / 2.20462) * 10) / 10 : v;
        else profile[field] = v == null ? null : Math.round(v);
        await updateSettings({ profile });
        if (field === 'birthYear' || field === 'maxHr') render();
      })
    );
    root.querySelectorAll('[data-widget]').forEach((b) =>
      b.addEventListener('click', async () => {
        const res = await tracker.pinWidget(b.dataset.widget).catch(() => ({ supported: false }));
        if (!res.supported) toast('Long-press your home screen, choose Widgets, then Locale');
      })
    );
    root.querySelector('[data-act="bglocation"]')?.addEventListener('click', async () => {
      try {
        const res = await tracker.requestBackgroundLocation();
        if (!res.granted) toast(`Choose "Allow all the time" for Locale's location permission`);
      } catch (e) {
        toast(e?.message ?? 'Allow location access first');
      }
      render();
    });
    root.querySelector('[data-toggle="keepScreenOn"]').addEventListener('change', (e) => updateSettings({ keepScreenOn: e.target.checked }));
    root.querySelector('[data-toggle="satellite3d"]').addEventListener('change', (e) => updateSettings({ satellite3d: e.target.checked }));
    root.querySelector('[data-toggle="smooth3d"]').addEventListener('change', (e) => updateSettings({ smooth3d: e.target.checked }));
    root.querySelectorAll('[data-autopause]').forEach((c) =>
      c.addEventListener('change', () => updateSettings({ autoPause: { ...settings().autoPause, [c.dataset.autopause]: c.checked } }))
    );
    root.querySelectorAll('[data-voice]').forEach((b) =>
      b.addEventListener('click', async () => {
        const { voice: kind, activity } = b.dataset;
        const voice = settings().voice;
        const on = !voice[kind][activity];
        await updateSettings({ voice: { ...voice, [kind]: { ...voice[kind], [activity]: on } } });
        b.setAttribute('aria-pressed', String(on));
      })
    );
    root.querySelectorAll('[data-goalmode]').forEach((b) =>
      b.addEventListener('click', async () => {
        const id = b.dataset.goalmode;
        const voice = settings().voice;
        const next = GOAL_MODES[(GOAL_MODES.indexOf(voice.goalMode[id] ?? 'off') + 1) % GOAL_MODES.length];
        await updateSettings({ voice: { ...voice, goalMode: { ...voice.goalMode, [id]: next } } });
        render();
      })
    );
    root.querySelector('[data-toggle="confirmGoal"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, confirmGoal: e.target.checked } })
    );
    const findRoutine = (id) => Object.values(model?.activities ?? {}).flatMap((a) => a.routines).find((r) => r.id === id);
    root.querySelectorAll('[data-rename]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = findRoutine(b.dataset.rename);
        if (!r) return;
        const name = await openDialog((dlg, close) => {
          dlg.innerHTML = `
            <h2>Rename routine</h2>
            <p>Used when Locale says the goal: "your usual …"</p>
            <label class="field"><span>Name</span><input type="text" maxlength="40" autofocus /></label>
            <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Save</button></div>`;
          const input = dlg.querySelector('input');
          input.value = r.name;
          dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
          dlg.querySelector('[data-v="save"]').addEventListener('click', () => close(input.value.trim()));
        });
        if (name == null) return;
        const routines = settings().routines;
        const names = { ...routines.names };
        if (name) names[r.id] = name;
        else delete names[r.id];
        await updateSettings({ routines: { ...routines, names } });
        await rebuildRoutineModel();
        render();
      })
    );
    root.querySelectorAll('[data-forget]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = findRoutine(b.dataset.forget);
        if (!r) return;
        const ok = await confirmDialog({
          title: 'Forget this routine?',
          message: `Locale stops predicting "${r.name}" and leaves its ${r.count} workouts out of learning. The workouts themselves are kept.`,
          confirmLabel: 'Forget',
          danger: true,
        });
        if (!ok) return;
        const routines = settings().routines;
        await updateSettings({ routines: { ...routines, excluded: [...new Set([...routines.excluded, ...r.workoutIds])] } });
        await rebuildRoutineModel();
        render();
      })
    );
    root.querySelector('[data-act="unforget"]')?.addEventListener('click', async () => {
      await updateSettings({ routines: { ...settings().routines, excluded: [] } });
      await rebuildRoutineModel();
      render();
    });
    root.querySelector('[data-act="voicetest"]').addEventListener('click', () => {
      const unit = imperial ? 1609.344 : 1000;
      const text = `${spokenDistance(5 * unit, imperial)}. Split time 6 minutes 12 seconds. ${spokenAverage(5 * unit, 5 * 378000, { pace: true, imperial })}`;
      tracker.speak(text, settings().voice.duck).catch((e) => toast(e?.message ?? 'Text-to-speech is not available'));
    });
    root.querySelector('[data-act="battery"]')?.addEventListener('click', () => tracker.requestIgnoreBatteryOptimizations());
    root.querySelector('[data-act="appsettings"]').addEventListener('click', () => tracker.openAppSettings());
    if (tracker.isNative) {
      App.getInfo()
        .then((info) => {
          const v = root.querySelector('[data-ref="version"]');
          if (v) v.textContent = `v${info.version} (${info.build})`;
        })
        .catch(() => {});
    }
  };
  await render();
  // Re-check status after returning from system settings.
  const handle = App.addListener('resume', render);
  d.add(() => handle.then((h) => h.remove()));
  return () => d.dispose();
}

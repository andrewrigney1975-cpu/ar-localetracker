import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { maxHeartRate } from '../stats/physio.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { App } from '@capacitor/app';

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
    const [caps, perms, workouts, watch] = await Promise.all([
      tracker.getCapabilities().catch(() => null),
      tracker.checkPermissions().catch(() => null),
      listWorkouts().catch(() => []),
      tracker.getWatchStatus().catch(() => null),
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

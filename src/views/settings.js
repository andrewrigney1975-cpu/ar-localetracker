import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { Disposer } from '../ui/dom.js';
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
    const [caps, perms, workouts] = await Promise.all([
      tracker.getCapabilities().catch(() => null),
      tracker.checkPermissions().catch(() => null),
      listWorkouts().catch(() => []),
    ]);
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
              <div class="setting"><div class="text">Map style</div>
                ${segmented('mapStyle', Object.entries(MAP_STYLE_LABELS), s.mapStyle)}</div>
              <div class="setting"><div class="text">3D vertical exaggeration<small>Auto fits the climb to the route size</small></div>
                ${segmented('exaggeration', [['auto', 'Auto'], ['2', '2×'], ['5', '5×'], ['10', '10×']], s.exaggeration)}</div>
              <label class="setting"><span class="text">Satellite in 3D<small>Show aerial imagery under the 3D route (needs a connection)</small></span>
                <input type="checkbox" class="switch" data-toggle="satellite3d" ${s.satellite3d ? 'checked' : ''} /></label>
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
          await updateSettings({ [group.dataset.seg]: b.dataset.v });
          render();
        })
      )
    );
    root.querySelector('[data-toggle="keepScreenOn"]').addEventListener('change', (e) => updateSettings({ keepScreenOn: e.target.checked }));
    root.querySelector('[data-toggle="satellite3d"]').addEventListener('change', (e) => updateSettings({ satellite3d: e.target.checked }));
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

import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { segmented } from '../ui/segmented.js';
import { toast } from '../ui/toast.js';
import { App } from '@capacitor/app';
import { INTERVAL_OPTIONS, spokenAverage, spokenDistance } from '../voice/coach.js';

const GOAL_MODES = ['auto', 'set', 'off'];
const GOAL_LABELS = { auto: 'Auto goal', set: 'Set goal', off: 'Goal' };

const MAP_STYLE_LABELS = { streets: 'Streets', light: 'Light', dark: 'Dark', topo: 'Topo' };

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
    const imperial = s.units === 'imperial';
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
                ['1x1', '1 × 1', 'Your last-used activity. One tap starts recording.'],
                ['2x1', '2 × 1', 'Run and walk. One tap starts recording.'],
                ['2x2', '2 × 2', 'Walk, run, cycle and ski. One tap starts recording.'],
                ['week', '2 × 2 this week', 'Distance of your workouts this week, Sunday to Saturday.'],
                ['week-chart', '4 × 2 this week', "This week's distance, with a chart of distance per day."],
              ]
                .map(([size, label, desc]) => `<div class="setting"><div class="text">${label}<small>${desc}</small></div>
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
              <label class="setting"><span class="text">Always loud<small>Turns the media volume up to full while Locale speaks, then back to where it was</small></span>
                <input type="checkbox" class="switch" data-toggle="loud" ${s.voice.loud ? 'checked' : ''} /></label>
              <label class="setting"><span class="text">Vibrate the watch<small>A buzz on your Wear OS watch with each announcement: two taps for a split, one for time, three for a goal milestone</small></span>
                <input type="checkbox" class="switch" data-toggle="watchBuzz" ${s.voice.watchBuzz ? 'checked' : ''} /></label>
              <label class="setting"><span class="text">Say the goal at the start<small>For example "Goal 4.7 kilometres, your usual Saturday morning loop"</small></span>
                <input type="checkbox" class="switch" data-toggle="confirmGoal" ${s.voice.confirmGoal ? 'checked' : ''} /></label>
              <label class="setting"><span class="text">Countdown<small>On your routines, the last kilometre to the goal: 1000, 500, 200 and 100 metres to go</small></span>
                <input type="checkbox" class="switch" data-toggle="countdown" ${s.voice.countdown ? 'checked' : ''} /></label>
              <div class="setting"><div class="text">Splits every ${imperial ? 'mile' : 'kilometre'}; goal at 25, 50, 75 and 100%<small>Auto goal: learned from your usual routes and times. Set goal: the distance chosen on the start screen. Tap a goal chip to switch. Your routines and their own announcements are under You.</small></div>
                <button class="btn ghost" data-act="voicetest">Test</button></div>
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
          if (key === 'voice.intervalMin') await updateSettings({ voice: { ...settings().voice, intervalMin: Number(b.dataset.v) } });
          else if (key === 'voice.duck') await updateSettings({ voice: { ...settings().voice, duck: b.dataset.v === 'true' } });
          else await updateSettings({ [key]: b.dataset.v });
          render();
        })
      )
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
    root.querySelector('[data-toggle="watchBuzz"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, watchBuzz: e.target.checked } })
    );
    root.querySelector('[data-toggle="confirmGoal"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, confirmGoal: e.target.checked } })
    );
    root.querySelector('[data-toggle="countdown"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, countdown: e.target.checked } })
    );
    root.querySelector('[data-toggle="loud"]').addEventListener('change', (e) => updateSettings({ voice: { ...settings().voice, loud: e.target.checked } }));
    root.querySelector('[data-act="voicetest"]').addEventListener('click', () => {
      const unit = imperial ? 1609.344 : 1000;
      const text = `${spokenDistance(5 * unit, imperial)}. Split time 6 minutes 12 seconds. ${spokenAverage(5 * unit, 5 * 378000, { pace: true, imperial })}`;
      const v = settings().voice;
      tracker.speak(text, v.duck, v.watchBuzz ? 'split' : null, v.loud).catch((e) => toast(e?.message ?? 'Text-to-speech is not available'));
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

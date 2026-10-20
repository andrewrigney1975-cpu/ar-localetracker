import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { initialsOf } from '../course/courseFile.js';
import { listWorkouts } from '../db/workouts.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { bmi, bmiCategory, maxHeartRate } from '../stats/physio.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { toast } from '../ui/toast.js';
import { App } from '@capacitor/app';
import { INTERVAL_OPTIONS, spokenAverage, spokenDistance } from '../voice/coach.js';
import { getRoutineModel, rebuildRoutineModel } from '../insights/model.js';
import { displayName } from '../insights/routines.js';
import { GOAL_ACTIVITIES, GOAL_METRICS, GOAL_PERIODS, goalList, goalsFor, withGoals } from '../insights/goals.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { effortFor } from '../insights/effort.js';
import { currentVo2max, VO2_ACTIVITIES, vo2Available } from '../stats/vo2max.js';

const GOAL_MODES = ['auto', 'set', 'off'];
const GOAL_LABELS = { auto: 'Auto goal', set: 'Set goal', off: 'Goal' };
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const clock = (min) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

/** Read-only BMI row: worked out from height and weight. */
function bmiHTML(p) {
  const v = bmi(p);
  return `<div class="text">BMI<small>${v == null ? 'From your height and weight' : bmiCategory(v)}</small></div>
    <span class="input-unit"><output class="bmi-value num" aria-label="Body mass index">${v == null ? '–' : v.toFixed(1)}</output>kg/m²</span>`;
}

/** Read-only VO2max row; the value is filled in by fillVo2 once the workouts are checked. */
function vo2HTML(value, hint) {
  return `<div class="text">VO2max (est.)<small>${hint}</small></div>
    <span class="input-unit"><output class="bmi-value num" aria-label="Estimated VO2max">${value}</output>ml/kg/min</span>`;
}

/**
 * The current estimate: median of the last 4 weeks' walks and runs with heart rate (HUNT
 * walking model, cached per workout in the effort cache).
 */
async function fillVo2(row, workouts, profile) {
  if (!row) return;
  if (!vo2Available(profile)) {
    row.innerHTML = vo2HTML('–', 'Needs your sex, birth year and weight');
    return;
  }
  const now = Date.now();
  const recent = workouts.filter((w) => VO2_ACTIVITIES.includes(w.activity) && w.summary?.heartRate && w.startedAt >= now - 28 * 86400000);
  if (!recent.length) {
    row.innerHTML = vo2HTML('–', 'From walks or runs with watch heart rate in the last 4 weeks');
    return;
  }
  row.innerHTML = vo2HTML('…', 'Working it out from your recent workouts');
  const effort = await effortFor(recent, profile).catch(() => new Map());
  if (!row.isConnected) return;
  const c = currentVo2max(recent.map((w) => ({ at: w.startedAt, value: effort.get(w.id)?.vo2 })), now);
  row.innerHTML = c
    ? vo2HTML(c.value.toFixed(1), `Median of ${c.count} workout${c.count === 1 ? '' : 's'} in the last 4 weeks${c.count > 1 ? ` · range ${c.min.toFixed(1)}–${c.max.toFixed(1)}` : ''}`)
    : vo2HTML('–', 'No steady 5-minute stretches with reliable heart rate in the last 4 weeks');
}

/** "Sat", "Tue & Thu", "Mon, Wed & Fri": the days a routine is usually done on. */
function usualDays(weekdays) {
  const total = weekdays.reduce((a, b) => a + b, 0);
  const days = weekdays.map((n, d) => [n, d]).filter(([n]) => n >= total * 0.2).map(([, d]) => DAY_SHORT[d]);
  if (!days.length) return 'any day';
  return days.length === 1 ? days[0] : `${days.slice(0, -1).join(', ')} & ${days[days.length - 1]}`;
}

const M_PER_MI = 1609.344;
const goalActivityLabel = (a) => (a === 'all' ? 'All activities' : ACTIVITIES[a].label);
const goalPeriodLabel = (p) => GOAL_PERIODS.find((x) => x.id === p).label;
const round1 = (v) => String(Math.round(v * 10) / 10);

/** "20 km · 3:00 h · load 300 · 2,000 kcal" for one activity and period. */
function goalSummary(values, imperial) {
  const parts = [];
  if (values.distance) parts.push(`${round1(values.distance / (imperial ? M_PER_MI : 1000))} ${imperial ? 'mi' : 'km'}`);
  if (values.time) parts.push(`${Math.floor(values.time / 3600)}:${String(Math.round((values.time % 3600) / 60)).padStart(2, '0')} h`);
  if (values.cardioLoad) parts.push(`load ${Math.round(values.cardioLoad).toLocaleString()}`);
  if (values.calories) parts.push(`${Math.round(values.calories).toLocaleString()} kcal`);
  return parts.join(' · ');
}

function goalsHTML(s) {
  const imperial = s.units === 'imperial';
  const rows = goalList(s.goals).map(
    ({ activity, period, values }) => `<button class="setting goal-row" data-goal="${activity}.${period}" ${activity !== 'all' ? `data-activity="${activity}"` : ''}>
      <span class="act-label">${activity === 'all' ? '' : ACTIVITIES[activity].icon}<span class="text">${goalActivityLabel(activity)} · ${goalPeriodLabel(period).toLowerCase()}<small>${goalSummary(values, imperial)}</small></span></span>
      <span class="goal-edit">Edit</span></button>`
  );
  return `
    <div class="section-title">Goals</div>
    <div class="card settings-group">
      ${rows.join('') || '<div class="setting"><div class="text">No goals yet<small>Set a distance, time, cardio load or calorie target per day, week or month. Insights charts show it, and the 4 × 2 widget tracks a distance goal through the week.</small></div></div>'}
      <div class="setting"><div class="text">${rows.length ? 'Another goal' : 'Add a goal'}</div><button class="btn ghost" data-act="addgoal">Add</button></div>
    </div>`;
}

/** Edit the goals for one activity and period; switching either loads that pair's goals. */
async function editGoals(start) {
  const imperial = settings().units === 'imperial';
  const unitM = imperial ? M_PER_MI : 1000;
  let activity = start.activity;
  let period = start.period;
  const result = await openDialog((dlg, close) => {
    dlg.classList.add('goal-dialog');
    dlg.innerHTML = `
      <h2>Goal</h2>
      <div class="field"><span>Activity</span>
        <div class="chip-row" role="radiogroup" aria-label="Activity">
          ${GOAL_ACTIVITIES.map((a) => `<button class="chip" role="radio" data-a="${a}" ${a !== 'all' ? `data-activity="${a}"` : ''}>${a === 'all' ? 'All' : ACTIVITIES[a].icon + ACTIVITIES[a].label}</button>`).join('')}
        </div>
      </div>
      <div class="field"><span>Period</span>
        <div class="segmented" role="group" aria-label="Period">${GOAL_PERIODS.map((p) => `<button data-p="${p.id}">${p.label}</button>`).join('')}</div>
      </div>
      <div class="goal-fields">
        <label><b>Distance</b><i class="input-unit"><input class="num-input" type="number" inputmode="decimal" min="0" step="0.1" data-m="distance" placeholder="–" />${imperial ? 'mi' : 'km'}</i></label>
        <label><b>Activity time</b><i class="input-unit"><input class="num-input short" type="number" inputmode="numeric" min="0" data-m="hours" placeholder="–" />h<input class="num-input short" type="number" inputmode="numeric" min="0" max="59" data-m="minutes" placeholder="–" />min</i></label>
        <label><b>Cardio load</b><i class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="0" data-m="cardioLoad" placeholder="–" /></i></label>
        <label><b>Calories</b><i class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="0" data-m="calories" placeholder="–" />kcal</i></label>
      </div>
      <p class="field-hint">Leave a box empty for no goal. Cardio load and calories need your profile.</p>
      <div class="actions"><button class="btn ghost" data-v="remove">Remove</button><button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Save</button></div>`;
    const input = (m) => dlg.querySelector(`[data-m="${m}"]`);
    const removeBtn = dlg.querySelector('[data-v="remove"]');
    const load = () => {
      dlg.querySelectorAll('[data-a]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.a === activity)));
      dlg.querySelectorAll('[data-p]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === period)));
      const v = goalsFor(settings().goals, activity, period);
      input('distance').value = v.distance ? round1(v.distance / unitM) : '';
      input('hours').value = v.time ? Math.floor(v.time / 3600) : '';
      input('minutes').value = v.time ? Math.round((v.time % 3600) / 60) : '';
      input('cardioLoad').value = v.cardioLoad ? Math.round(v.cardioLoad) : '';
      input('calories').value = v.calories ? Math.round(v.calories) : '';
      removeBtn.hidden = !GOAL_METRICS.some((m) => v[m] > 0);
    };
    dlg.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => ((activity = b.dataset.a), load())));
    dlg.querySelectorAll('[data-p]').forEach((b) => b.addEventListener('click', () => ((period = b.dataset.p), load())));
    load();
    const num = (m) => Math.max(0, Number(input(m).value) || 0);
    dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
    removeBtn.addEventListener('click', () => close({}));
    dlg.querySelector('[data-v="save"]').addEventListener('click', () =>
      close({
        distance: Math.round(num('distance') * unitM * 10) / 10,
        time: Math.round(num('hours') * 3600 + num('minutes') * 60),
        cardioLoad: num('cardioLoad'),
        calories: num('calories'),
      })
    );
  });
  if (!result) return false;
  await updateSettings({ goals: withGoals(settings().goals, activity, period, result) });
  // The 4 × 2 widget shows progress against a distance goal.
  tracker.refreshWidgets().catch(() => {});
  return true;
}

function routinesHTML(model, s) {
  const imperial = s.units === 'imperial';
  const unit = imperial ? 'mi' : 'km';
  const rows = [];
  const learning = [];
  for (const id of ACTIVITY_IDS) {
    const a = model?.activities?.[id];
    // Routines you marked are listed even with auto goals off: they still name workouts.
    const auto = s.voice.goalMode[id] === 'auto';
    if (auto && !a?.ready) learning.push(`${ACTIVITIES[id].label}: ${a?.usable ?? 0} of ${model?.need ?? 5}`);
    for (const r of (a?.routines ?? []).filter((x) => (auto && a.ready && (x.eligible || x.suppressed)) || x.user)) {
      const goal = Math.round((r.goal[imperial ? 'imperial' : 'metric'] / (imperial ? 1609.344 : 1000)) * 100) / 100;
      const hit = r.predictions ? ` · goal hit ${r.hits} of ${r.predictions}` : '';
      const custom = s.voice.routines?.[r.id] ? ' · own announcements' : '';
      rows.push(`<div class="setting stack routine" data-activity="${id}"><span class="act-label">${ACTIVITIES[id].icon}<span class="text">${escapeHtml(r.name[0].toUpperCase() + r.name.slice(1))}
          <small>${r.user ? 'Marked by you · ' : ''}${goal} ${unit} · ${r.count} times · ${usualDays(r.weekdays)} ~${clock(r.startMin)}${hit}${r.suppressed ? ' · paused: recent goals missed' : ''}${custom}</small></span></span>
          <span class="voice-kinds"><button class="chip" data-rename="${escapeHtml(r.id)}">Rename</button><button class="chip" data-customise="${escapeHtml(r.id)}">Customise</button><button class="chip" data-forget="${escapeHtml(r.id)}">${r.user ? 'Remove' : 'Forget'}</button></span></div>`);
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

            ${goalsHTML(s)}

            <div class="section-title">Profile</div>
            <div class="card settings-group">
              <label class="setting"><span class="text">Your name<small>${p.name ? `Shared courses are labelled ${escapeHtml(initialsOf(p.name))}` : 'Your initials label the courses you share'}</small></span>
                <input class="text-input" type="text" maxlength="60" autocomplete="name" data-name value="${escapeHtml(p.name ?? '')}" placeholder="First Last" /></label>
              <div class="setting"><div class="text">Sex<small>Used for calories and cardio load</small></div>
                ${segmented('profile.sex', [['male', 'Male'], ['female', 'Female']], p.sex)}</div>
              <label class="setting"><span class="text">Birth year</span>
                <input class="num-input" type="number" inputmode="numeric" min="1900" max="2025" data-profile="birthYear" value="${p.birthYear ?? ''}" placeholder="1985" /></label>
              <label class="setting"><span class="text">Height</span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="50" max="250" data-profile="heightCm" value="${p.heightCm ?? ''}" placeholder="175" />cm</span></label>
              <label class="setting"><span class="text">Weight</span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="decimal" min="20" max="300" step="0.5" data-profile="weight" value="${weightShown}" placeholder="${imperial ? '165' : '75'}" />${imperial ? 'lb' : 'kg'}</span></label>
              <div class="setting" data-ref="bmi">${bmiHTML(p)}</div>
              <label class="setting"><span class="text">Resting heart rate<small>Optional · default 60</small></span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="30" max="120" data-profile="restingHr" value="${p.restingHr ?? ''}" placeholder="60" />bpm</span></label>
              <label class="setting"><span class="text">Max heart rate<small>Optional · ${estMax ? `estimated ${estMax} from age` : 'estimated from age'}</small></span>
                <span class="input-unit"><input class="num-input" type="number" inputmode="numeric" min="120" max="230" data-profile="maxHr" value="${p.maxHr ?? ''}" placeholder="${estMax ?? '185'}" />bpm</span></label>
              <div class="setting" data-ref="vo2">${vo2HTML('–', 'From walks and runs with watch heart rate')}</div>
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

    fillVo2(root.querySelector('[data-ref="vo2"]'), workouts, p);

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
    root.querySelector('[data-name]').addEventListener('change', async (e) => {
      await updateSettings({ profile: { ...settings().profile, name: e.target.value.trim() || null } });
      render();
    });
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
        if (field === 'weight' || field === 'heightCm') root.querySelector('[data-ref="bmi"]').innerHTML = bmiHTML(profile);
        if (field === 'birthYear' || field === 'maxHr') render();
        else if (field === 'weight' || field === 'restingHr') fillVo2(root.querySelector('[data-ref="vo2"]'), workouts, profile);
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
    root.querySelector('[data-toggle="watchBuzz"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, watchBuzz: e.target.checked } })
    );
    root.querySelector('[data-toggle="confirmGoal"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, confirmGoal: e.target.checked } })
    );
    root.querySelector('[data-toggle="countdown"]').addEventListener('change', (e) =>
      updateSettings({ voice: { ...settings().voice, countdown: e.target.checked } })
    );
    root.querySelectorAll('[data-goal]').forEach((b) =>
      b.addEventListener('click', async () => {
        const [activity, period] = b.dataset.goal.split('.');
        if (await editGoals({ activity, period })) render();
      })
    );
    root.querySelector('[data-act="addgoal"]').addEventListener('click', async () => {
      // Start from the first pair without goals: weekly first, All before each activity.
      const used = new Set(goalList(settings().goals).map((g) => `${g.activity}.${g.period}`));
      const pairs = ['week', 'day', 'month'].flatMap((period) => GOAL_ACTIVITIES.map((activity) => ({ activity, period })));
      if (await editGoals(pairs.find((p) => !used.has(`${p.activity}.${p.period}`)) ?? pairs[0])) render();
    });
    root.querySelector('[data-toggle="loud"]').addEventListener('change', (e) => updateSettings({ voice: { ...settings().voice, loud: e.target.checked } }));
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
        if (r.user) {
          if (!name) return;
          await updateSettings({ routines: { ...routines, user: routines.user.map((u) => (u.id === r.id ? { ...u, name } : u)) } });
        } else {
          const names = { ...routines.names };
          if (name) names[r.id] = name;
          else delete names[r.id];
          await updateSettings({ routines: { ...routines, names } });
        }
        await rebuildRoutineModel();
        render();
      })
    );
    root.querySelectorAll('[data-customise]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = findRoutine(b.dataset.customise);
        if (!r) return;
        const activity = Object.keys(model.activities).find((id) => model.activities[id].routines.includes(r));
        const v = settings().voice;
        const own = v.routines?.[r.id];
        // Start from the routine's own settings, else the activity's.
        const cur = own ?? { splits: Boolean(v.splits[activity]), time: Boolean(v.time[activity]), goal: v.goalMode[activity] !== 'off', intervalMin: v.intervalMin };
        const result = await openDialog((dlg, close) => {
          const chip = (kind, label) => `<button class="chip" data-kind="${kind}" aria-pressed="${Boolean(cur[kind])}">${label}</button>`;
          dlg.classList.add('routine-voice');
          dlg.innerHTML = `
            <h2>Announcements for ${escapeHtml(displayName(r.name))}</h2>
            <p>Used instead of the ${ACTIVITIES[activity]?.label ?? ''} settings when Locale recognises this routine at the start.</p>
            <div class="voice-kinds">${chip('splits', 'Splits')}${chip('time', 'Time')}${chip('goal', 'Goal')}</div>
            <p>Time announcements every</p>
            ${segmented('interval', INTERVAL_OPTIONS.map((m) => [m, `${m} min`]), cur.intervalMin)}
            <div class="actions">${own ? '<button class="btn ghost" data-v="reset">Use defaults</button>' : ''}<button class="btn ghost" data-v="cancel">Cancel</button><button class="btn primary" data-v="save">Save</button></div>`;
          const next = { ...cur };
          dlg.querySelectorAll('[data-kind]').forEach((c) =>
            c.addEventListener('click', () => {
              next[c.dataset.kind] = !next[c.dataset.kind];
              c.setAttribute('aria-pressed', String(next[c.dataset.kind]));
            })
          );
          dlg.querySelectorAll('[data-seg] button').forEach((c) =>
            c.addEventListener('click', () => {
              next.intervalMin = Number(c.dataset.v);
              dlg.querySelectorAll('[data-seg] button').forEach((o) => o.setAttribute('aria-pressed', String(o === c)));
            })
          );
          dlg.querySelector('[data-v="reset"]')?.addEventListener('click', () => close('reset'));
          dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
          dlg.querySelector('[data-v="save"]').addEventListener('click', () => close(next));
        });
        if (result == null) return;
        const voice = settings().voice;
        const routines = { ...voice.routines };
        if (result === 'reset') delete routines[r.id];
        else routines[r.id] = { splits: result.splits, time: result.time, goal: result.goal, intervalMin: result.intervalMin };
        await updateSettings({ voice: { ...voice, routines } });
        render();
      })
    );
    root.querySelectorAll('[data-forget]').forEach((b) =>
      b.addEventListener('click', async () => {
        const r = findRoutine(b.dataset.forget);
        if (!r) return;
        if (r.user) {
          const sure = await confirmDialog({
            title: 'Remove this routine?',
            message: `"${r.name}" stops being a routine you marked. Its ${r.count} workouts go back to automatic learning and lose its name, unless you renamed them.`,
            confirmLabel: 'Remove',
            danger: true,
          });
          if (!sure) return;
          const routines = settings().routines;
          await updateSettings({ routines: { ...routines, user: routines.user.filter((u) => u.id !== r.id) } });
          await rebuildRoutineModel();
          render();
          return;
        }
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

// You: personal settings and data (profile, VO2max, goals, learned routines). Device and
// app options stay in Settings.

import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { initialsOf } from '../course/courseFile.js';
import { listWorkouts } from '../db/workouts.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { ageAt, bmi, bmiCategory, maxHeartRate } from '../stats/physio.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { segmented } from '../ui/segmented.js';
import { toast } from '../ui/toast.js';
import { INTERVAL_OPTIONS } from '../voice/coach.js';
import { getRoutineModel, rebuildRoutineModel } from '../insights/model.js';
import { displayName } from '../insights/routines.js';
import { GOAL_ACTIVITIES, GOAL_METRICS, GOAL_PERIODS, goalList, goalsFor, withGoals } from '../insights/goals.js';
import { confirmDialog, openDialog } from '../ui/dialog.js';
import { effortFor } from '../insights/effort.js';
import { currentVo2max, VO2_ACTIVITIES, vo2Available } from '../stats/vo2max.js';
import { ordinal, rateVo2max, VO2_CATEGORIES } from '../stats/vo2norms.js';

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
 * Norms chart under the VO2max row: the categories as one row of coloured segments on an
 * ml/kg/min scale, the 4-week range shaded and the estimate as a white dot, then a table of
 * the categories and their ranges. `current` is from currentVo2max, or null for the norms alone.
 */
function vo2ChartHTML(profile, current) {
  const rating = rateVo2max(current?.value ?? null, profile.sex, ageAt(profile));
  if (!rating) return '';
  const { ranges } = rating;
  const first = ranges[0].max;
  const last = ranges[ranges.length - 1].min;
  // Room either side of the open-ended categories, and for the estimates.
  let lo = Math.floor(first - (ranges[1].max - first) * 1.5);
  let hi = Math.ceil(last + (last - ranges[ranges.length - 2].min) * 0.6);
  if (current) {
    lo = Math.min(lo, Math.floor(current.min - 1));
    hi = Math.max(hi, Math.ceil(current.max + 1));
  }
  const x = (v) => `${(((v - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const fmt = (v) => v.toFixed(1);
  const segments = ranges
    .map((r, i) => {
      const from = r.min ?? lo;
      const to = r.max ?? hi;
      return `<i class="vo2-seg c${i}${i === rating.category ? ' current' : ''}" style="left:${x(from)};width:calc(${x(to)} - ${x(from)})"></i>`;
    })
    .join('');
  const rows = ranges
    .map((r, i) => {
      const text = r.min == null ? `< ${fmt(r.max)}` : r.max == null ? `≥ ${fmt(r.min)}` : `${fmt(r.min)}–${fmt(r.max)}`;
      return `<tr${i === rating.category ? ' class="current"' : ''}><th scope="row"><i class="vo2-swatch c${i}"></i>${r.label}</th><td class="num">${text}</td></tr>`;
    })
    .join('');
  const who = `${profile.sex === 'female' ? 'women' : 'men'} aged ${rating.band}${rating.clamped ? ' (nearest age group)' : ''}`;
  let head = `Norms for ${who}`;
  if (current) {
    const pct = rating.below ? 'below the 5th percentile' : rating.above ? 'above the 95th percentile' : `${ordinal(rating.percentile)} percentile`;
    head = `<strong>${VO2_CATEGORIES[rating.category].label}</strong> · ${pct} for ${who}`;
  }
  const marks = current
    ? `${current.count > 1 ? `<i class="vo2-span" style="left:${x(current.min)};width:calc(${x(current.max)} - ${x(current.min)})"></i>` : ''}
        <i class="vo2-mark" style="left:${x(current.value)}"><b class="num">${fmt(current.value)}</b></i>`
    : '';
  const note = current
    ? `Dot: your estimate${current.count > 1 ? '. Shaded: the range of your walks in the last 4 weeks' : ''}. `
    : '';
  return `<div class="vo2-head">${head}</div>
    <div class="vo2-chart${current ? ' has-mark' : ''}" role="img" aria-label="VO2max categories for ${who}${current ? `; your estimate ${fmt(current.value)} is ${VO2_CATEGORIES[rating.category].label}` : ''}">
      <span class="vo2-scale">${segments}</span>${marks}
    </div>
    <table class="vo2-table"><caption class="visually-hidden">VO2max categories for ${who}, ml/kg/min</caption><tbody>${rows}</tbody></table>
    <small class="vo2-note">${note}Values in ml/kg/min. Norms: Cooper Institute (ACSM Guidelines, 11th ed.), via vo2maxcalculators.com.</small>`;
}

/** Show or hide the chart row below the VO2max row. */
function setVo2Chart(row, profile, current) {
  const chart = row.parentElement?.querySelector('[data-ref="vo2chart"]');
  if (!chart) return;
  const html = vo2Available(profile) ? vo2ChartHTML(profile, current) : '';
  chart.innerHTML = html;
  chart.hidden = !html;
}

/**
 * The current estimate: median of the last 4 weeks' walks with heart rate (HUNT
 * walking model, cached per workout in the effort cache).
 */
async function fillVo2(row, workouts, profile) {
  if (!row) return;
  setVo2Chart(row, profile, null);
  if (!vo2Available(profile)) {
    row.innerHTML = vo2HTML('–', 'Needs your sex, birth year and weight');
    return;
  }
  const now = Date.now();
  const recent = workouts.filter((w) => VO2_ACTIVITIES.includes(w.activity) && w.summary?.heartRate && w.startedAt >= now - 28 * 86400000);
  if (!recent.length) {
    row.innerHTML = vo2HTML('–', 'From walks with watch heart rate in the last 4 weeks');
    return;
  }
  row.innerHTML = vo2HTML('…', 'Working it out from your recent workouts');
  const effort = await effortFor(recent, profile).catch(() => new Map());
  if (!row.isConnected) return;
  const c = currentVo2max(recent.map((w) => ({ at: w.startedAt, value: effort.get(w.id)?.vo2 })), now);
  row.innerHTML = c
    ? vo2HTML(c.value.toFixed(1), `Median of ${c.count} walk${c.count === 1 ? '' : 's'} in the last 4 weeks${c.count > 1 ? ` · range ${c.min.toFixed(1)}–${c.max.toFixed(1)}` : ''}`)
    : vo2HTML('–', 'No steady 5-minute stretches with reliable heart rate in the last 4 weeks');
  setVo2Chart(row, profile, c);
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

export async function mount(root) {
  const d = new Disposer();
  const render = async () => {
    const s = settings();
    const [workouts, model] = await Promise.all([listWorkouts().catch(() => []), getRoutineModel().catch(() => null)]);
    const p = s.profile;
    const imperial = s.units === 'imperial';
    const weightShown = p.weightKg ? Math.round(imperial ? p.weightKg * 2.20462 : p.weightKg) : '';
    const estMax = maxHeartRate({ ...p, maxHr: null });
    root.innerHTML = `
      <div class="screen">
        <header class="topbar"><h1>You</h1></header>
        <div class="body">
          <div class="page">
            <div class="section-title">Profile</div>
            <div class="card settings-group">
              <label class="setting"><span class="text">Your name<small>${p.name ? `Shared courses are labelled ${escapeHtml(initialsOf(p.name))}` : 'Your initials label the courses you share'}</small></span>
                <input class="text-input" type="text" maxlength="60" autocomplete="name" data-name value="${escapeHtml(p.name ?? '')}" placeholder="First Last" /></label>
              <div class="setting"><div class="text">Sex<small>Used for calories, cardio load and VO2max</small></div>
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
              <div class="setting" data-ref="vo2">${vo2HTML('–', 'From walks with watch heart rate')}</div>
              <div class="setting stack vo2-chart-row" data-ref="vo2chart" hidden></div>
            </div>

            ${goalsHTML(s)}

            ${routinesHTML(model, s)}
          </div>
        </div>
      </div>`;

    fillVo2(root.querySelector('[data-ref="vo2"]'), workouts, p);

    root.querySelectorAll('[data-seg^="profile."] button').forEach((b) =>
      b.addEventListener('click', async () => {
        const key = b.parentElement.dataset.seg.slice(8);
        await updateSettings({ profile: { ...settings().profile, [key]: b.dataset.v } });
        render();
      })
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
  };
  await render();
  return () => d.dispose();
}

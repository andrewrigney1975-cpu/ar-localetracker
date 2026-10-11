import { ACTIVITIES, ACTIVITY_IDS } from '../activities.js';
import { listWorkouts } from '../db/workouts.js';
import { effortAvailability, effortFor, pruneEffortCache } from '../insights/effort.js';
import {
  buildReport,
  canShiftWindow,
  GROUPINGS,
  isoDate,
  METRICS,
  metricValue,
  nextPeriod,
  parseIsoDate,
  periodTick,
  reportEntry,
  reportFilename,
  reportToCSV,
  reportToJSON,
  shiftCustom,
  windowBounds,
  windowDates,
  windowLabel,
  WINDOWS,
} from '../insights/report.js';
import { shareFile } from '../services/share.js';
import { settings } from '../settings.js';
import { openDialog } from '../ui/dialog.js';
import { Disposer, el, escapeHtml, on } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { distanceUnit, distanceValue, formatDuration, M_PER_MI, paceUnit, speedUnit, speedValue } from '../units.js';

// Stack and legend order: keeps cycle (blue) and ski (violet) apart, which are hard to tell
// apart side by side with red-green colour blindness.
const STACK_ORDER = ['cycle', 'run', 'walk', 'ski'];

const GROUP_LABELS = { day: 'Daily', week: 'Weekly', month: 'Monthly', quarter: 'Every 3 months', year: 'Yearly' };

const STATE_KEY = 'insights.view.v1';
const DEFAULT_STATE = { range: '12m', group: 'month', activity: 'all', split: false, metric: 'distance', from: null, to: null };

function loadState() {
  let s;
  try {
    s = { ...DEFAULT_STATE, ...JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}') };
  } catch {
    s = { ...DEFAULT_STATE };
  }
  // "30 days" was replaced by "This month".
  if (!WINDOWS.some((w) => w.id === s.range)) s.range = 'month';
  return s;
}

function saveState(s) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(s));
  } catch {
    // Per-viewer convenience only.
  }
}

/** Display conversion and formatting for each metric in the user's units. */
function metricFormat(metric, units) {
  const unitM = units === 'imperial' ? M_PER_MI : 1000;
  switch (metric) {
    case 'distance':
      return { unit: distanceUnit(units), value: (m) => distanceValue(m, units), text: (v) => v.toFixed(v >= 100 ? 0 : 1) };
    case 'speed':
      return { unit: speedUnit(units), value: (v) => speedValue(v, units), text: (v) => v.toFixed(1) };
    case 'pace':
      return { unit: paceUnit(units), value: (sPerKm) => (sPerKm * unitM) / 1000, text: clock };
    case 'time':
      return { unit: 'h', value: (s) => s / 3600, text: hoursMinutes, axis: (v) => `${round(v)}` };
    case 'heartRate':
      return { unit: 'bpm', value: (v) => v, text: (v) => String(Math.round(v)) };
    case 'cardioLoad':
      return { unit: '', value: (v) => v, text: (v) => Math.round(v).toLocaleString() };
    default:
      return { unit: 'kcal', value: (v) => v, text: (v) => Math.round(v).toLocaleString() };
  }
}

const round = (v) => (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10);
const hoursMinutes = (hours) => {
  const mins = Math.round(hours * 60);
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
};
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`.replace(/:60$/, ':59');

/** Clean axis ticks from 0 to at least `max`. */
function niceTicks(max, pace) {
  if (!(max > 0)) return [0, 1];
  if (pace) {
    const steps = [15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => max / s <= 5) ?? 1200;
    const ticks = [];
    for (let v = 0; v < max + step; v += step) ticks.push(v);
    return ticks;
  }
  const raw = max / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const ticks = [];
  for (let v = 0; v < max + step * 0.999; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

const compact = (v) => (v >= 10000 ? `${round(v / 1000)}K` : v.toLocaleString());

export async function mount(root, params, query) {
  const d = new Disposer();
  const units = settings().units;
  const state = loadState();
  let workouts = [];
  let report = null;
  let renderToken = 0;

  root.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <h1>Insights</h1>
        <button class="icon-btn" data-act="export" aria-label="Export report">${icons.share}</button>
      </header>
      <div class="body">
        <div class="page insights">
          <div class="period-row">
            <button class="icon-btn step" data-step="-1" aria-label="Earlier">${icons.back}</button>
            <select class="select" data-ref="range" aria-label="Date range">
              ${WINDOWS.map((w) => `<option value="${w.id}">${w.label}</option>`).join('')}
            </select>
            <button class="icon-btn step" data-step="1" aria-label="Later">${icons.back}</button>
            <select class="select" data-ref="group" aria-label="Group by">
              ${GROUPINGS.map((g) => `<option value="${g.id}">${GROUP_LABELS[g.id]}</option>`).join('')}
            </select>
          </div>
          <div class="period-dates num" data-ref="dates"></div>
          <div class="date-range" data-ref="custom" hidden>
            <label><span>From</span><input type="date" data-ref="from" /></label>
            <label><span>To</span><input type="date" data-ref="to" /></label>
          </div>
          <div class="filter-row" role="radiogroup" aria-label="Activity">
            <button class="chip" role="radio" data-activity-filter="all">All</button>
            ${ACTIVITY_IDS.map((id) => `<button class="chip" role="radio" data-activity-filter="${id}" data-activity="${id}">${ACTIVITIES[id].icon}${ACTIVITIES[id].label}</button>`).join('')}
          </div>
          <label class="split-toggle" data-ref="split-row"><span>Separate activity types</span><input type="checkbox" class="switch" data-ref="split" /></label>
          <div data-slot="content"></div>
        </div>
      </div>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const content = $('[data-slot="content"]');
  const fromInput = $('[data-ref="from"]');
  const toInput = $('[data-ref="to"]');
  const rangeSelect = $('[data-ref="range"]');
  const groupSelect = $('[data-ref="group"]');
  /** Windows back from the current one (0 = today / this week / …); not remembered. */
  let offset = 0;

  const bounds = () => windowBounds(state.range, offset, { earliest: earliest(), from: state.from, to: state.to });

  function syncControls() {
    const [from, to] = bounds();
    rangeSelect.value = state.range;
    // The selected option names the window on screen ("Last week", "August 2026").
    for (const o of rangeSelect.options) o.textContent = o.value === state.range ? windowLabel(state.range, offset, from, to) : WINDOWS.find((w) => w.id === o.value).label;
    groupSelect.value = state.group;
    $('[data-ref="dates"]').textContent = windowDates(from, to);
    root.querySelectorAll('[data-step]').forEach((b) => (b.disabled = !canShiftWindow(state.range, offset, Number(b.dataset.step), { from: state.from, to: state.to })));
    root.querySelectorAll('[data-activity-filter]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.activityFilter === state.activity)));
    $('[data-ref="custom"]').hidden = state.range !== 'custom';
    $('[data-ref="split-row"]').hidden = state.activity !== 'all';
    $('[data-ref="split"]').checked = state.split;
  }

  const change = (patch) => {
    Object.assign(state, patch);
    saveState(state);
    syncControls();
    render();
  };
  rangeSelect.addEventListener('change', () => {
    const range = rangeSelect.value;
    if (range === 'custom') {
      // Start the custom range from what was on screen.
      const [f, t] = bounds();
      offset = 0;
      change({ range, from: isoDate(f), to: isoDate(t) });
    } else {
      offset = 0;
      change({ range });
    }
  });
  groupSelect.addEventListener('change', () => change({ group: groupSelect.value }));
  root.querySelectorAll('[data-step]').forEach((b) =>
    b.addEventListener('click', () => {
      const step = Number(b.dataset.step);
      if (!canShiftWindow(state.range, offset, step, { from: state.from, to: state.to })) return;
      if (state.range === 'custom') {
        const [f, t] = bounds();
        change(shiftCustom(isoDate(f), isoDate(t), step));
      } else {
        offset += step;
        change({});
      }
    })
  );
  root.querySelectorAll('[data-activity-filter]').forEach((b) => b.addEventListener('click', () => change({ activity: b.dataset.activityFilter })));
  $('[data-ref="split"]').addEventListener('change', (e) => change({ split: e.target.checked }));
  fromInput.addEventListener('change', () => fromInput.value && change({ from: fromInput.value }));
  toInput.addEventListener('change', () => toInput.value && change({ to: toInput.value }));

  const earliest = () => (workouts.length ? Math.min(...workouts.map((w) => w.startedAt)) : null);

  async function render() {
    const token = ++renderToken;
    const [from, to] = bounds();
    fromInput.value = isoDate(from);
    toInput.value = isoDate(to);
    const profile = settings().profile;
    const inRange = workouts.filter((w) => w.startedAt >= from && w.startedAt < nextPeriod(to, 'day') && (state.activity === 'all' || w.activity === state.activity));
    const draw = (effort) => {
      const entries = workouts.map((w) => reportEntry(w, effort?.get(w.id)));
      report = buildReport(entries, { from, to, group: state.group, activity: state.activity, split: state.activity === 'all' && state.split });
      renderContent(effort == null);
    };
    draw(null);
    const effort = await effortFor(inRange, profile, {
      isCancelled: () => token !== renderToken,
      onProgress: (done, total) => {
        const p = content.querySelector('[data-ref="progress"]');
        if (p && total) p.textContent = `Calculating calories and cardio load… ${done}/${total}`;
      },
    });
    if (token !== renderToken) return;
    draw(effort);
  }

  function renderContent(pending) {
    if (!workouts.length) {
      content.innerHTML = `<div class="empty">${icons.insights}<div>No workouts yet. Your reports will appear here.</div></div>`;
      return;
    }
    const t = report.total;
    const can = effortAvailability(settings().profile);
    const pace = metricFormat('pace', units);
    const tiles = [
      ['Workouts', String(t.workouts), ''],
      ['Distance', metricFormat('distance', units).text(distanceValue(t.distanceM, units)), distanceUnit(units)],
      ['Activity time', formatDuration(t.activityTimeS), ''],
      ['Avg speed', t.avgSpeedMps ? speedValue(t.avgSpeedMps, units).toFixed(1) : '–', speedUnit(units)],
      ['Avg pace', t.avgPaceSPerKm ? pace.text(pace.value(t.avgPaceSPerKm)) : '–', paceUnit(units)],
      ['Avg heart rate', t.avgHrBpm ? String(Math.round(t.avgHrBpm)) : '–', 'bpm'],
      ['Cardio load', t.cardioLoad != null ? Math.round(t.cardioLoad).toLocaleString() : pending && can.cardioLoad ? '…' : '–', ''],
      ['Calories', t.caloriesKcal != null ? Math.round(t.caloriesKcal).toLocaleString() : pending && can.calories ? '…' : '–', 'kcal'],
    ];
    const hint =
      !can.calories || !can.cardioLoad
        ? `<p class="effort-hint">Add your sex, birth year and weight in <a href="#/settings">Settings → Profile</a> to include calories and cardio load.</p>`
        : '';
    content.innerHTML = `
      <div class="stat-grid num insights-totals">${tiles.map(([label, value, unit]) => `<div class="stat"><label>${label}</label><div class="value">${value}${unit ? `<small>${unit}</small>` : ''}</div></div>`).join('')}</div>
      ${pending ? '<p class="about" data-ref="progress"></p>' : ''}
      ${hint}
      <div class="filter-row metric-row" role="radiogroup" aria-label="Chart">
        ${METRICS.map((m) => `<button class="chip" role="radio" data-metric="${m.id}" aria-checked="${m.id === state.metric}">${m.label}</button>`).join('')}
      </div>
      <div class="card chart-card" data-ref="chart"></div>
      <div class="section-title">By ${GROUPINGS.find((g) => g.id === state.group).label.toLowerCase()}</div>
      <div class="table-scroll">${tableHTML()}</div>
      <p class="about">Speed and pace use moving time. Heart rate is averaged over workouts that recorded it, weighted by their length. Calories and cardio load are estimates.</p>`;
    content.querySelectorAll('[data-metric]').forEach((b) =>
      b.addEventListener('click', () => {
        state.metric = b.dataset.metric;
        saveState(state);
        content.querySelectorAll('[data-metric]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
        renderChart(content.querySelector('[data-ref="chart"]'));
      })
    );
    renderChart(content.querySelector('[data-ref="chart"]'));
  }

  function tableHTML() {
    const rows = report.periods.filter((p) => p.total.workouts).reverse();
    if (!rows.length) return '<div class="empty">No workouts in this range.</div>';
    const cell = (metric, row) => {
      const v = metricValue(row, metric);
      if (v == null) return '–';
      const f = metricFormat(metric, units);
      return f.text(f.value(v));
    };
    const line = (label, row, cls = '') => `<tr class="${cls}">
        <td>${label}</td><td>${row.workouts}</td><td>${cell('distance', row)}</td><td>${formatDuration(row.activityTimeS)}</td>
        <td>${cell('speed', row)}</td><td>${cell('pace', row)}</td><td>${cell('heartRate', row)}</td><td>${cell('cardioLoad', row)}</td><td>${cell('calories', row)}</td></tr>`;
    const body = rows
      .map((p) => {
        let html = line(escapeHtml(p.label), p.total, report.split ? 'group-total' : '');
        if (report.split) {
          for (const a of ACTIVITY_IDS) {
            if (p.byActivity[a]) html += line(`<span class="key" style="background:var(--${a})"></span>${ACTIVITIES[a].label}`, p.byActivity[a], 'sub');
          }
        }
        return html;
      })
      .join('');
    return `<table class="report-table num">
      <thead><tr><th>Period</th><th>#</th><th>${distanceUnit(units)}</th><th>Time</th><th>${speedUnit(units)}</th><th>${paceUnit(units)}</th><th>bpm</th><th>Load</th><th>kcal</th></tr></thead>
      <tbody>${body}</tbody></table>`;
  }

  function renderChart(host) {
    const metric = state.metric;
    const def = METRICS.find((m) => m.id === metric);
    const f = metricFormat(metric, units);
    const periods = report.periods;
    const series = report.split ? STACK_ORDER.filter((a) => report.activities.includes(a)) : [state.activity];
    const valueOf = (p, a) => {
      const row = report.split ? p.byActivity[a] : p.total;
      const v = row ? metricValue(row, metric) : null;
      return v == null ? null : f.value(v);
    };
    const stacked = report.split && def.sum;
    let max = 0;
    for (const p of periods) {
      if (stacked) max = Math.max(max, series.reduce((s, a) => s + (valueOf(p, a) ?? 0), 0));
      else for (const a of series) max = Math.max(max, valueOf(p, a) ?? 0);
    }
    const title = `${def.label}${f.unit ? ` (${f.unit})` : ''}${def.sum ? ` per ${GROUPINGS.find((g) => g.id === state.group).label.toLowerCase()}` : ''}`;
    if (!max) {
      host.innerHTML = `<div class="chart-title">${title}</div><div class="chart-empty">No ${def.label.toLowerCase()} data in this range.</div>`;
      return;
    }
    const ticks = niceTicks(max, metric === 'pace');
    const top = ticks[ticks.length - 1];
    const groupCount = stacked ? 1 : series.length;
    const avail = Math.max(200, (host.clientWidth || 340) - 40 - 18);
    const slot = Math.max(groupCount > 1 ? 8 * groupCount + 6 : 14, Math.min(64, avail / periods.length));
    const H = 200;
    const padL = 4;
    const axisW = 40;
    const padB = 24;
    const plotW = slot * periods.length;
    const W = padL + plotW + 8;
    const y = (v) => 8 + (H - 8 - padB) * (1 - v / top);
    const axisText = (v) => (metric === 'pace' ? clock(v) : f.axis ? f.axis(v) : compact(v));
    const barW = Math.min(24, (slot - 4) / groupCount);
    const rr = (x, y0, w, h, rounded) => {
      // Rounded data end (4px), square at the baseline.
      const r = rounded ? Math.min(4, w / 2, h) : 0;
      return `M${x},${y0 + h}V${y0 + r}${r ? `Q${x},${y0} ${x + r},${y0}` : ''}H${x + w - r}${r ? `Q${x + w},${y0} ${x + w},${y0 + r}` : ''}V${y0 + h}Z`;
    };
    const marks = [];
    const labelEvery = Math.ceil((state.group === 'day' || state.group === 'week' ? 52 : 40) / slot);
    periods.forEach((p, i) => {
      const x0 = padL + i * slot;
      if (stacked) {
        let acc = 0;
        const present = series.filter((a) => valueOf(p, a));
        present.forEach((a, k) => {
          const v = valueOf(p, a);
          const yTop = y(acc + v);
          const yBase = y(acc);
          // 2px surface gap between stacked segments.
          const h = Math.max(0, yBase - yTop - (k > 0 ? 2 : 0));
          marks.push(`<path d="${rr(x0 + (slot - barW) / 2, yTop, barW, h, k === present.length - 1)}" fill="var(--${a})"/>`);
          acc += v;
        });
      } else {
        series.forEach((a, k) => {
          const v = valueOf(p, a);
          if (!v) return;
          const bx = x0 + (slot - barW * groupCount - 2 * (groupCount - 1)) / 2 + k * (barW + 2);
          const color = a === 'all' ? 'var(--accent)' : `var(--${a})`;
          marks.push(`<path d="${rr(bx, y(v), barW, y(0) - y(v), true)}" fill="${color}"/>`);
        });
      }
      if (i % labelEvery === 0) marks.push(`<text class="tick" x="${x0 + slot / 2}" y="${H - 6}" text-anchor="middle">${escapeHtml(periodTick(p.start, state.group))}</text>`);
      marks.push(`<rect class="hit" data-i="${i}" x="${x0}" y="0" width="${slot}" height="${H - padB}"/>`);
    });
    const grid = ticks
      .map((v) => `<line class="grid" x1="0" x2="${padL + plotW}" y1="${y(v)}" y2="${y(v)}"/>`)
      .join('');
    // The y-axis stays put while a long time axis scrolls.
    const axis = ticks.map((v) => `<text class="tick" x="${axisW - 6}" y="${y(v) + 4}" text-anchor="end">${axisText(v)}</text>`).join('');
    const legend =
      series.length > 1
        ? `<div class="chart-legend">${series.map((a) => `<span><i style="background:var(--${a})"></i>${ACTIVITIES[a].label}</span>`).join('')}</div>`
        : '';
    host.innerHTML = `
      <div class="chart-title">${title}</div>
      ${legend}
      <div class="chart-body">
        <svg class="chart-axis" width="${axisW}" height="${H}" aria-hidden="true">${axis}</svg>
        <div class="chart-scroll" ${state.activity !== 'all' ? `data-activity="${state.activity}"` : ''}>
          <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)}">${grid}${marks.join('')}</svg>
        </div>
      </div>
      <div class="chart-tip" hidden></div>`;
    const scroller = host.querySelector('.chart-scroll');
    scroller.scrollLeft = scroller.scrollWidth;
    const tip = host.querySelector('.chart-tip');
    const show = (rect) => {
      const p = periods[Number(rect.dataset.i)];
      const lines = [];
      if (report.split) {
        for (const a of series) {
          const v = valueOf(p, a);
          if (v) lines.push(`<div><i style="background:var(--${a})"></i>${ACTIVITIES[a].label}<b>${f.text(v)}</b></div>`);
        }
      }
      const total = metricValue(p.total, metric);
      lines.push(`<div class="tip-total">${report.split ? 'All' : `${p.total.workouts} workout${p.total.workouts === 1 ? '' : 's'}`}<b>${total == null ? '–' : `${f.text(f.value(total))} ${f.unit}`}</b></div>`);
      tip.innerHTML = `<div class="tip-head">${escapeHtml(p.label)}</div>${lines.join('')}`;
      tip.hidden = false;
      host.querySelectorAll('.hit').forEach((r) => r.classList.toggle('on', r === rect));
      const box = host.getBoundingClientRect();
      const rb = rect.getBoundingClientRect();
      const left = Math.min(box.width - tip.offsetWidth - 8, Math.max(8, rb.left - box.left + rb.width / 2 - tip.offsetWidth / 2));
      tip.style.left = `${left}px`;
    };
    host.querySelectorAll('.hit').forEach((r) => {
      r.addEventListener('pointerenter', () => show(r));
      r.addEventListener('click', () => show(r));
    });
    host.querySelector('.chart-scroll svg').addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') {
        tip.hidden = true;
        host.querySelectorAll('.hit.on').forEach((r) => r.classList.remove('on'));
      }
    });
  }

  $('[data-act="export"]').addEventListener('click', async () => {
    if (!report || !workouts.length) {
      toast('No workouts to export');
      return;
    }
    const fmt = await openDialog((dlg, close) => {
      dlg.innerHTML = `<h2>Export report</h2>
        <p>${escapeHtml(report.periods.filter((p) => p.total.workouts).length.toString())} periods, ${report.total.workouts} workouts. Values are in metric (SI) units.</p>
        <div class="option-list"></div>
        <div class="actions"><button class="btn ghost" data-v="cancel">Cancel</button></div>`;
      dlg.querySelector('[data-v="cancel"]').addEventListener('click', () => close(null));
      const list = dlg.querySelector('.option-list');
      for (const [id, label, desc] of [
        ['csv', 'CSV', 'Spreadsheet: one row per period' + (report.split ? ' and activity' : '')],
        ['json', 'JSON', 'Structured data with totals'],
      ]) {
        const b = el(`<button><span class="tag">${label}</span><span>${label}<small>${desc}</small></span></button>`);
        b.addEventListener('click', () => close(id));
        list.appendChild(b);
      }
    });
    if (!fmt) return;
    try {
      const csv = fmt === 'csv';
      await shareFile({
        filename: reportFilename(report, fmt),
        content: csv ? reportToCSV(report) : reportToJSON(report),
        mime: csv ? 'text/csv' : 'application/json',
        title: 'Locale insights',
      });
    } catch (e) {
      console.error(e);
      toast(`Export failed: ${e?.message ?? e}`);
    }
  });

  async function reload() {
    workouts = (await listWorkouts()).filter((w) => !String(w.id).startsWith('sample-'));
    pruneEffortCache(workouts.map((w) => w.id));
    syncControls();
    await render();
  }

  d.add(on(window, 'workouts-changed', reload));
  d.add(() => renderToken++);
  syncControls();
  await reload();
  return () => d.dispose();
}

import { describe, expect, it } from 'vitest';
import {
  buildReport,
  exportRows,
  isoDate,
  nextPeriod,
  periodStart,
  reportEntry,
  reportToCSV,
  reportToJSON,
} from '../src/insights/report.js';

const at = (y, m, d, h = 7) => new Date(y, m - 1, d, h).getTime();

function workout(id, activity, startedAt, { distance = 5000, duration = 1800, movingTime = duration, hr = null } = {}) {
  return {
    id,
    activity,
    startedAt,
    summary: { distance, duration, movingTime, ...(hr ? { heartRate: { avg: hr[0], max: hr[1] } } : {}) },
  };
}

describe('periods', () => {
  it('starts weeks on Monday', () => {
    // Sunday 11 Oct 2026 belongs to the week of Monday 5 Oct.
    expect(isoDate(periodStart(at(2026, 10, 11), 'week'))).toBe('2026-10-05');
    expect(isoDate(periodStart(at(2026, 10, 12), 'week'))).toBe('2026-10-12');
  });

  it('groups quarters and years', () => {
    expect(isoDate(periodStart(at(2026, 8, 20), 'quarter'))).toBe('2026-07-01');
    expect(isoDate(nextPeriod(periodStart(at(2026, 11, 2), 'quarter'), 'quarter'))).toBe('2027-01-01');
    expect(isoDate(periodStart(at(2026, 8, 20), 'year'))).toBe('2026-01-01');
  });
});

describe('buildReport', () => {
  const ws = [
    workout('a', 'run', at(2026, 9, 1), { distance: 10000, duration: 3000, movingTime: 2500, hr: [150, 175] }),
    workout('b', 'run', at(2026, 9, 15), { distance: 5000, duration: 1500, movingTime: 1500, hr: [140, 160] }),
    workout('c', 'walk', at(2026, 9, 20), { distance: 4000, duration: 3000, movingTime: 2800 }),
    workout('d', 'cycle', at(2026, 10, 3), { distance: 30000, duration: 3600, movingTime: 3600 }),
    workout('old', 'run', at(2026, 6, 1)),
  ];
  const effort = { a: { kcal: 700, load: 90 }, b: { kcal: 350, load: 40 }, c: { kcal: 200, load: null }, d: { kcal: 800, load: null } };
  const entries = ws.map((w) => reportEntry(w, effort[w.id]));
  const opts = { from: at(2026, 9, 1, 0), to: at(2026, 10, 11, 0), group: 'month' };

  it('totals and averages each period', () => {
    const r = buildReport(entries, opts);
    expect(r.periods.map((p) => isoDate(p.start))).toEqual(['2026-09-01', '2026-10-01']);
    const sep = r.periods[0].total;
    expect(sep.workouts).toBe(3);
    expect(sep.distanceM).toBe(19000);
    expect(sep.activityTimeS).toBe(7500);
    expect(sep.avgSpeedMps).toBeCloseTo(19000 / 6800);
    expect(sep.avgPaceSPerKm).toBeCloseTo(6800 / 19);
    // Duration-weighted, only workouts with heart rate.
    expect(sep.avgHrBpm).toBeCloseTo((150 * 3000 + 140 * 1500) / 4500);
    expect(sep.maxHrBpm).toBe(175);
    expect(sep.cardioLoad).toBe(130);
    expect(sep.caloriesKcal).toBe(1250);
    expect(r.periods[1].total.cardioLoad).toBeNull();
    expect(r.total.workouts).toBe(4); // June is outside the range
  });

  it('filters by activity and splits by activity', () => {
    const runs = buildReport(entries, { ...opts, activity: 'run' });
    expect(runs.total.workouts).toBe(2);
    const split = buildReport(entries, { ...opts, split: true });
    expect(Object.keys(split.periods[0].byActivity).sort()).toEqual(['run', 'walk']);
    expect(split.periods[0].byActivity.walk.distanceM).toBe(4000);
    expect(split.activities).toEqual(['walk', 'run', 'cycle']);
  });

  it('includes empty periods so the time axis is even', () => {
    const r = buildReport(entries, { ...opts, group: 'week' });
    expect(r.periods.length).toBe(6);
    expect(r.periods.filter((p) => p.total.workouts).length).toBe(3);
  });

  it('exports CSV and JSON rows for periods with workouts', () => {
    const r = buildReport(entries, { ...opts, split: true });
    const rows = exportRows(r);
    expect(rows.map((x) => `${x.periodStart} ${x.activity}`)).toEqual(['2026-09-01 walk', '2026-09-01 run', '2026-10-01 cycle']);
    expect(rows[2].periodEnd).toBe('2026-10-31');
    const csv = reportToCSV(r).trim().split('\n');
    expect(csv[0]).toBe(
      'period_start,period_end,period,activity,workouts,distance_m,activity_time_s,moving_time_s,avg_speed_mps,avg_pace_s_per_km,avg_pace_s_per_mi,avg_hr_bpm,max_hr_bpm,cardio_load,calories_kcal'
    );
    expect(csv).toHaveLength(4);
    expect(csv[1].split(',')[3]).toBe('walk');
    const json = JSON.parse(reportToJSON(r, { generatedAt: 0 }));
    expect(json.grouping).toBe('month');
    expect(json.from).toBe('2026-09-01');
    expect(json.totals.workouts).toBe(4);
    expect(json.rows).toHaveLength(3);
    expect(json.rows[0].avgHrBpm).toBeNull();
  });
});

describe('changing a workout activity', async () => {
  const { buildWorkout, rebuildAsActivity } = await import('../src/services/buildWorkout.js');
  const { generateJournal } = await import('../src/tracker/synthetic.js');
  const { text } = generateJournal({ activity: 'run', seconds: 900 });
  const { workout, track } = buildWorkout(text);
  workout.notes = 'kept';

  it('re-processes the raw journal as the new activity', () => {
    const { workout: w, track: t } = rebuildAsActivity(workout, 'ski', { rawText: text });
    expect(w.activity).toBe('ski');
    expect(w.id).toBe(workout.id);
    expect(w.notes).toBe('kept');
    expect(w.name).toBe(workout.name.replace('Run', 'Ski'));
    expect(w.summary.ski).toBeDefined();
    expect(t.n).toBeGreaterThan(1);
  });

  it('keeps a name the user chose', () => {
    const { workout: w } = rebuildAsActivity({ ...workout, name: 'Park loop' }, 'walk', { rawText: text });
    expect(w.name).toBe('Park loop');
  });

  it('recomputes the summary from the track without a raw journal', () => {
    const { workout: w, track: t } = rebuildAsActivity({ ...workout, activity: 'ski', summary: { ...workout.summary, ski: { runs: 1 } } }, 'run', { track });
    expect(t).toBe(track);
    expect(w.summary.ski).toBeUndefined();
    expect(w.summary.distance).toBeCloseTo(workout.summary.distance);
  });
});

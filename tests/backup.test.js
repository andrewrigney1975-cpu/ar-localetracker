import { describe, expect, it } from 'vitest';
import { BackupError, buildBackup, parseBackup, restoreBackup } from '../src/backup/backup.js';
import { crc32, packTrack, toBase64 } from '../src/db/trackCodec.js';
import { processJournal } from '../src/geo/process.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

/** A save item as the stores export it. */
function item(id, seed, raw = true) {
  const { track } = processJournal(parseJournal(generateJournal({ seconds: 300, seed }).text));
  const blob = packTrack(track);
  const it = { workout: { id, name: `Walk ${id}`, startedAt: seed * 1000, summary: { distance: track.dist[track.n - 1] } }, track: { blob: toBase64(blob), crc32: crc32(blob) } };
  if (raw) {
    const bytes = new TextEncoder().encode(`raw journal ${id}`);
    it.raw = { gzip: toBase64(bytes), crc32: crc32(bytes) };
  }
  return it;
}

/** In-memory stand-ins for the facade, course store and Preferences. */
function stores(items = [], courses = [], prefs = {}) {
  const db = new Map(items.map((i) => [i.workout.id, i]));
  const saved = [...courses];
  const kv = { ...prefs };
  return {
    db,
    saved,
    kv,
    listWorkouts: async () => [...db.values()].map((i) => i.workout),
    exportItem: async (id) => db.get(id) ?? null,
    exportCourses: async () => saved,
    getPref: async (key) => kv[key] ?? null,
    importItems: async (batch) =>
      batch.map((i) => {
        db.set(i.workout.id, i);
        return { id: i.workout.id, n: 1, trackCrc: i.track.crc32, rawCrc: i.raw ? i.raw.crc32 : -1 };
      }),
    saveCourse: async (text, filename, { addedAt }) => {
      if (text.includes('broken')) throw new Error('no route');
      saved.push({ entry: { id: `c-${saved.length}`, filename, addedAt }, text });
    },
    setPref: async (key, value) => {
      kv[key] = value;
    },
  };
}

const COURSE = { entry: { id: 'c1', filename: 'AR City2Surf.gpx', addedAt: 123 }, text: '<gpx>route</gpx>' };
const SETTINGS = JSON.stringify({ units: 'metric', theme: 'dark' });

async function backupText(src) {
  const { lines } = await buildBackup({ ...src, app: '1.0 (1)', now: Date.UTC(2026, 9, 27, 3, 35) });
  return lines.join('\n') + '\n';
}

describe('backup', () => {
  it('round-trips workouts, raw journals, courses and settings into another phone', async () => {
    const src = stores([item('a', 1), item('b', 2, false)], [COURSE], { 'settings.v1': SETTINGS, 'routines.v1': '{"derived":true}' });
    const progress = [];
    const { counts } = await buildBackup({ ...src, onProgress: (d, t) => progress.push(`${d}/${t}`) });
    expect(counts).toEqual({ workouts: 2, courses: 1, prefs: 1 });
    expect(progress).toEqual(['0/2', '1/2', '2/2']);

    const parsed = parseBackup(await backupText(src));
    expect(parsed.header).toMatchObject({ format: 'locale-backup', version: 1, app: '1.0 (1)', createdAt: Date.UTC(2026, 9, 27, 3, 35) });

    const dst = stores([item('old', 9)]);
    const r = await restoreBackup(parsed, dst);
    expect(r).toEqual({ workouts: 2, courses: 1, prefs: 1, skippedCourses: 0 });
    // Merged: the phone's own workout stays, the backup's are byte-identical.
    expect([...dst.db.keys()].sort()).toEqual(['a', 'b', 'old']);
    expect(dst.db.get('a')).toEqual(src.db.get('a'));
    expect(dst.db.get('b').raw).toBeUndefined();
    expect(dst.saved).toEqual([{ entry: { id: 'c-0', filename: 'AR City2Surf.gpx', addedAt: 123 }, text: '<gpx>route</gpx>' }]);
    // Settings come back; the routine model is derived, so it isn't carried.
    expect(dst.kv).toEqual({ 'settings.v1': SETTINGS });
  });

  it('rejects files that are not Locale backups, or from a newer version', async () => {
    expect(() => parseBackup('')).toThrow('not a Locale backup');
    expect(() => parseBackup('{"type":"header","format":"other"}')).toThrow(BackupError);
    const text = await backupText(stores([item('a', 1)]));
    expect(() => parseBackup(text.replace('"version":1', '"version":2'))).toThrow('newer version');
  });

  it('notices a backup cut off while saving', async () => {
    const text = await backupText(stores([item('a', 1), item('b', 2)], [COURSE]));
    const lines = text.trim().split('\n');
    expect(() => parseBackup(lines.slice(0, -1).join('\n'))).toThrow('incomplete');
    expect(() => parseBackup([...lines.slice(0, 2), ...lines.slice(3)].join('\n'))).toThrow('incomplete');
    expect(() => parseBackup(text.slice(0, text.length / 2))).toThrow(/incomplete|damaged/);
  });

  it('stops when a workout does not store intact', async () => {
    const parsed = parseBackup(await backupText(stores([item('a', 1)])));
    const dst = stores();
    dst.importItems = async (batch) => batch.map((i) => ({ id: i.workout.id, n: 1, trackCrc: 0, rawCrc: -1 }));
    await expect(restoreBackup(parsed, dst)).rejects.toThrow('did not restore intact');
  });

  it('skips a course that no longer parses rather than failing the restore', async () => {
    const parsed = parseBackup(await backupText(stores([], [COURSE, { entry: { id: 'c2' }, text: 'broken' }])));
    const r = await restoreBackup(parsed, stores());
    expect(r).toMatchObject({ courses: 1, skippedCourses: 1 });
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { CLEANUP_AFTER_MS, META_MIGRATED, cleanupIndexedDb, migrateIndexedDbToNative } from '../src/db/migrate.js';
import { saveItem } from '../src/db/nativeStore.js';
import { crc32, fromBase64, unpackTrack } from '../src/db/trackCodec.js';
import { buildWorkout } from '../src/services/buildWorkout.js';
import { generateJournal } from '../src/tracker/synthetic.js';

/** IndexedDB stand-in with real processed workouts. */
function fakeSource(count) {
  const items = new Map();
  for (let k = 0; k < count; k++) {
    const { text } = generateJournal({ seconds: 300 + k * 60, seed: 100 + k, heartRate: k % 2 === 0 });
    const { workout, track } = buildWorkout(text, `w${k}`);
    items.set(workout.id, { workout, track, raw: new TextEncoder().encode(`gzip-${k}`) });
  }
  return {
    items,
    listWorkoutIds: async () => [...items.keys()],
    getWorkout: async (id) => items.get(id)?.workout,
    getTrack: async (id) => items.get(id)?.track ?? null,
    getRawGzipBytes: async (id) => items.get(id)?.raw ?? null,
  };
}

/** SQLite stand-in: stores blobs and recomputes n/CRC from what it stored, like WorkoutStore. */
function fakeTarget({ failOnCall = null, corrupt = false } = {}) {
  const rows = new Map();
  const meta = new Map();
  let calls = 0;
  return {
    rows,
    meta,
    async bulkImport(batch) {
      calls++;
      if (calls === failOnCall) throw new Error('simulated crash');
      return batch.map((item) => {
        let blob = fromBase64(item.track.blob);
        if (corrupt) blob = blob.slice(0, -1);
        const raw = item.raw ? fromBase64(item.raw.gzip) : null;
        rows.set(item.workout.id, { workout: item.workout, blob, raw });
        let n = -1;
        try {
          n = unpackTrack(blob).n;
        } catch {
          /* corrupt */
        }
        return { id: item.workout.id, n, trackCrc: crc32(blob), rawCrc: raw ? crc32(raw) : -1 };
      });
    },
    hasWorkout: async (id) => rows.has(id),
    getTrack: async (id) => (rows.has(id) ? unpackTrack(rows.get(id).blob) : null),
    getMeta: async (k) => meta.get(k) ?? null,
    setMeta: async (k, v) => void meta.set(k, v),
  };
}

describe('IndexedDB → SQLite migration', () => {
  let source;
  beforeEach(() => {
    source = fakeSource(23); // three batches of 10
  });

  it('copies every workout with verified tracks and journals, then marks done', async () => {
    const target = fakeTarget();
    const progress = [];
    const res = await migrateIndexedDbToNative({ source, target, saveItem, onProgress: (...a) => progress.push(a) });
    expect(res).toEqual({ status: 'migrated', count: 23 });
    expect(target.rows.size).toBe(23);
    expect(target.meta.get(META_MIGRATED)).toMatch(/^\d+$/);
    expect(progress.at(-1)).toEqual(['copy', 23, 23]);
    // Byte-exact tracks after the round trip.
    const orig = source.items.get('w7').track;
    const back = unpackTrack(target.rows.get('w7').blob);
    expect(new Uint8Array(back.dist.buffer)).toEqual(new Uint8Array(orig.dist.buffer));
    expect(target.rows.get('w7').raw).toEqual(source.items.get('w7').raw);
    expect('hr' in unpackTrack(target.rows.get('w0').blob)).toBe(true);
  });

  it('is a no-op once migrated', async () => {
    const target = fakeTarget();
    await migrateIndexedDbToNative({ source, target, saveItem });
    target.rows.clear();
    expect(await migrateIndexedDbToNative({ source, target, saveItem })).toEqual({ status: 'already', count: 0 });
    expect(target.rows.size).toBe(0);
  });

  it('does not mark done after a crash, and a re-run completes (idempotent upserts)', async () => {
    const target = fakeTarget({ failOnCall: 2 });
    await expect(migrateIndexedDbToNative({ source, target, saveItem })).rejects.toThrow('simulated crash');
    expect(target.meta.has(META_MIGRATED)).toBe(false);
    expect(target.rows.size).toBe(10); // first batch only
    const res = await migrateIndexedDbToNative({ source, target, saveItem });
    expect(res.count).toBe(23);
    expect(target.rows.size).toBe(23);
  });

  it('detects data that was not stored intact', async () => {
    const target = fakeTarget({ corrupt: true });
    await expect(migrateIndexedDbToNative({ source, target, saveItem })).rejects.toThrow(/Verification failed/);
    expect(target.meta.has(META_MIGRATED)).toBe(false);
  });

  it('handles an empty IndexedDB (fresh install)', async () => {
    const target = fakeTarget();
    const res = await migrateIndexedDbToNative({ source: fakeSource(0), target, saveItem });
    expect(res).toEqual({ status: 'migrated', count: 0 });
  });
});

describe('IndexedDB cleanup', () => {
  it('deletes the rollback copy only after 30 days, once', async () => {
    const target = fakeTarget();
    let deleted = 0;
    const deleteDatabase = async () => void deleted++;
    const t0 = 1_800_000_000_000;
    await target.setMeta(META_MIGRATED, String(t0));
    expect(await cleanupIndexedDb({ target, deleteDatabase, now: t0 + CLEANUP_AFTER_MS - 1 })).toBe(false);
    expect(await cleanupIndexedDb({ target, deleteDatabase, now: t0 + CLEANUP_AFTER_MS })).toBe(true);
    expect(await cleanupIndexedDb({ target, deleteDatabase, now: t0 + CLEANUP_AFTER_MS * 2 })).toBe(false);
    expect(deleted).toBe(1);
  });
});

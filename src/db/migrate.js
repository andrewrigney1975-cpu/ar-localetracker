// One-time IndexedDB → SQLite migration (docs/plans/sqlite-migration.md §5).
//
// Idempotent: re-running upserts the same rows. Nothing is deleted from IndexedDB; it
// stays as a rollback copy and is removed by cleanupIndexedDb() 30 days later.

export const META_MIGRATED = 'migrated_from_idb';
export const CLEANUP_AFTER_MS = 30 * 24 * 3600 * 1000;
const BATCH = 10;

/**
 * @param {object} deps
 * @param {{listWorkoutIds, getWorkout, getTrack, getRawGzipBytes}} deps.source  IndexedDB store
 * @param {{bulkImport, hasWorkout, getTrack, getMeta, setMeta}} deps.target    native store
 * @param {(workout, track, rawBytes) => {item, expected}} deps.saveItem
 * @param {(stage: string, done: number, total: number) => void} [deps.onProgress]
 * @returns {Promise<{status: 'already'|'migrated', count: number}>}
 */
export async function migrateIndexedDbToNative({ source, target, saveItem, onProgress = () => {} }) {
  if (await target.getMeta(META_MIGRATED)) return { status: 'already', count: 0 };

  const ids = await source.listWorkoutIds();
  onProgress('copy', 0, ids.length);
  let lastCopied = null;
  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = [];
    const expected = new Map();
    for (const id of ids.slice(i, i + BATCH)) {
      const workout = await source.getWorkout(id);
      const track = await source.getTrack(id);
      if (!workout || !track) throw new Error(`Workout ${id} is incomplete in IndexedDB`);
      const { item, expected: exp } = saveItem(workout, track, await source.getRawGzipBytes(id));
      batch.push(item);
      expected.set(id, { ...exp, last: { dist: track.dist[track.n - 1], t: track.t[track.n - 1] } });
    }
    const results = await target.bulkImport(batch);
    // Verify each row as SQLite actually stored it.
    for (const r of results) {
      const exp = expected.get(r.id);
      if (!exp || r.n !== exp.n || r.trackCrc !== exp.trackCrc || r.rawCrc !== exp.rawCrc) {
        throw new Error(`Verification failed for workout ${r.id}`);
      }
      expected.delete(r.id);
      lastCopied = { id: r.id, ...exp.last };
    }
    if (expected.size) throw new Error(`Workouts not stored: ${[...expected.keys()].join(', ')}`);
    onProgress('copy', Math.min(ids.length, i + BATCH), ids.length);
  }

  // Final checks: every workout is present, and a stored track decodes to the same data.
  for (const id of ids) if (!(await target.hasWorkout(id))) throw new Error(`Workout ${id} missing after migration`);
  if (lastCopied) {
    const back = await target.getTrack(lastCopied.id);
    const n = back?.n ?? 0;
    if (!back || back.dist[n - 1] !== lastCopied.dist || back.t[n - 1] !== lastCopied.t) {
      throw new Error('Spot check failed: stored track differs');
    }
  }
  await target.setMeta(META_MIGRATED, String(Date.now()));
  return { status: 'migrated', count: ids.length };
}

/** Delete the IndexedDB rollback copy once the migration is old enough. */
export async function cleanupIndexedDb({ target, deleteDatabase, now = Date.now() }) {
  const migratedAt = Number(await target.getMeta(META_MIGRATED));
  if (!migratedAt || now - migratedAt < CLEANUP_AFTER_MS) return false;
  if (await target.getMeta('idb_deleted')) return false;
  await deleteDatabase();
  await target.setMeta('idb_deleted', String(now));
  return true;
}


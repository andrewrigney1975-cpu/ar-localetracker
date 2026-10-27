// Backup and restore of everything Locale keeps: workouts (record, packed track, gzipped raw
// journal), courses (their original files) and settings. The file is newline-delimited JSON,
// gzipped by services/backup.js:
//   {type:'header', format:'locale-backup', version, createdAt, app, counts}
//   {type:'pref', key, value}            Preferences (settings.v1)
//   {type:'workout', item}               a save item: {workout, track: {blob, crc32}, raw?: {gzip, crc32}}
//   {type:'course', entry, text}
//   {type:'end', counts}                 so a cut-off file is caught
// Restoring merges: workouts and courses with the same id are replaced, others are kept;
// settings are replaced. Derived data (routine model, Insights caches) is rebuilt afterwards.
// Pure apart from the injected stores, so it is unit-tested.

export const BACKUP_FORMAT = 'locale-backup';
export const BACKUP_VERSION = 1;
/** Preferences worth keeping. routines.v1 is rebuilt from the workouts; courses.v1 from the course lines. */
export const PREF_KEYS = ['settings.v1'];
const BATCH = 10;

export class BackupError extends Error {}

/**
 * The backup's lines, without newlines.
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.listWorkouts
 * @param {(id: string) => Promise<object|null>} deps.exportItem
 * @param {() => Promise<{entry: object, text: string}[]>} deps.exportCourses
 * @param {(key: string) => Promise<string|null>} deps.getPref
 * @param {string} [deps.app]  app version, for the record
 * @param {(done: number, total: number) => void} [deps.onProgress]
 * @returns {Promise<{lines: string[], counts: {workouts: number, courses: number, prefs: number}}>}
 */
export async function buildBackup({ listWorkouts, exportItem, exportCourses, getPref, app = null, now = Date.now(), onProgress = () => {} }) {
  const prefs = [];
  for (const key of PREF_KEYS) {
    const value = await getPref(key);
    if (value != null) prefs.push(JSON.stringify({ type: 'pref', key, value }));
  }
  const workouts = await listWorkouts();
  const lines = [];
  onProgress(0, workouts.length);
  for (const [i, w] of workouts.entries()) {
    const item = await exportItem(w.id);
    if (item) lines.push(JSON.stringify({ type: 'workout', item }));
    onProgress(i + 1, workouts.length);
  }
  const courses = (await exportCourses()).map((c) => JSON.stringify({ type: 'course', entry: c.entry, text: c.text }));
  const counts = { workouts: lines.length, courses: courses.length, prefs: prefs.length };
  const header = JSON.stringify({ type: 'header', format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: now, app, counts });
  return { lines: [header, ...prefs, ...lines, ...courses, JSON.stringify({ type: 'end', counts })], counts };
}

/**
 * Read a backup's text, checking it is complete.
 * @returns {{header: object, prefs: {key: string, value: string}[], workouts: object[], courses: {entry: object, text: string}[]}}
 * @throws {BackupError} with a message fit to show
 */
export function parseBackup(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  let header;
  try {
    header = JSON.parse(lines[0] ?? '');
  } catch {
    header = null;
  }
  if (header?.type !== 'header' || header.format !== BACKUP_FORMAT) throw new BackupError('This file is not a Locale backup.');
  if (!(header.version <= BACKUP_VERSION)) throw new BackupError('This backup was made by a newer version of Locale. Update the app first.');
  const out = { header, prefs: [], workouts: [], courses: [] };
  let end = null;
  for (const line of lines.slice(1)) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      throw new BackupError('The backup is damaged (a line is not readable).');
    }
    if (rec.type === 'pref' && typeof rec.key === 'string' && typeof rec.value === 'string') out.prefs.push({ key: rec.key, value: rec.value });
    else if (rec.type === 'workout' && rec.item?.workout?.id && rec.item.track?.blob) out.workouts.push(rec.item);
    else if (rec.type === 'course' && rec.entry?.id && typeof rec.text === 'string') out.courses.push({ entry: rec.entry, text: rec.text });
    else if (rec.type === 'end') end = rec;
  }
  const c = header.counts ?? {};
  if (!end || out.workouts.length !== c.workouts || out.courses.length !== c.courses || out.prefs.length !== c.prefs) {
    throw new BackupError('The backup is incomplete. It may have been cut off while saving or copying.');
  }
  return out;
}

/**
 * Write a parsed backup into the stores, checking each workout as stored.
 * @param {ReturnType<typeof parseBackup>} backup
 * @param {object} deps
 * @param {(items: object[]) => Promise<{id, n, trackCrc, rawCrc}[]>} deps.importItems
 * @param {(text: string, filename: string, opts: {addedAt: number}) => Promise<any>} deps.saveCourse
 * @param {(key: string, value: string) => Promise<void>} deps.setPref
 * @param {(done: number, total: number) => void} [deps.onProgress]
 * @returns {Promise<{workouts: number, courses: number, prefs: number, skippedCourses: number}>}
 */
export async function restoreBackup(backup, { importItems, saveCourse, setPref, onProgress = () => {} }) {
  const { workouts, courses, prefs } = backup;
  onProgress(0, workouts.length);
  for (let i = 0; i < workouts.length; i += BATCH) {
    const batch = workouts.slice(i, i + BATCH);
    const results = await importItems(batch);
    for (const item of batch) {
      const r = results.find((x) => x.id === item.workout.id);
      // A raw journal is only checked when the backup has one (an old one may already be stored).
      if (!r || r.trackCrc !== item.track.crc32 || (item.raw && r.rawCrc !== item.raw.crc32)) {
        throw new BackupError(`Workout ${item.workout.name ?? item.workout.id} did not restore intact.`);
      }
    }
    onProgress(Math.min(workouts.length, i + BATCH), workouts.length);
  }
  let skippedCourses = 0;
  for (const { entry, text } of courses) {
    try {
      await saveCourse(text, entry.filename ?? '', { addedAt: entry.addedAt ?? Date.now() });
    } catch {
      skippedCourses++;
    }
  }
  for (const { key, value } of prefs) if (PREF_KEYS.includes(key)) await setPref(key, value);
  return { workouts: workouts.length, courses: courses.length - skippedCourses, prefs: prefs.length, skippedCourses };
}

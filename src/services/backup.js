// Backup file I/O: gathers everything through the storage facade, gzips it and hands it to
// the share sheet (Drive, Files, …); restore reads a picked file back. Format: backup/backup.js.

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Preferences } from '@capacitor/preferences';
import { buildBackup, parseBackup, restoreBackup } from '../backup/backup.js';
import { exportCourses, saveCourse } from '../course/courseStore.js';
import { exportItem, importItems, listWorkouts } from '../db/workouts.js';
import { gunzip, gzip } from '../db/idbStore.js';
import { rebuildRoutineModel } from '../insights/model.js';
import { loadSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { shareFile } from './share.js';

const pad = (n) => String(n).padStart(2, '0');

/** e.g. locale-backup-2026-10-27-1435.gz */
export function backupFilename(d = new Date()) {
  return `locale-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.gz`;
}

/** Build the backup and share it. @returns {Promise<{workouts, courses, prefs, bytes}>} */
export async function shareBackup({ onProgress } = {}) {
  const app = Capacitor.isNativePlatform() ? await App.getInfo().then((i) => `${i.version} (${i.build})`).catch(() => null) : 'browser';
  const { lines, counts } = await buildBackup({
    listWorkouts,
    exportItem,
    exportCourses,
    getPref: async (key) => (await Preferences.get({ key })).value,
    app,
    onProgress,
  });
  const bytes = new Uint8Array(await (await gzip(lines.join('\n') + '\n')).arrayBuffer());
  await shareFile({ filename: backupFilename(), content: bytes, mime: 'application/gzip', title: 'Locale backup', dialogTitle: 'Save backup' });
  return { ...counts, bytes: bytes.length };
}

/** Read and check a picked backup file (gzipped, or plain text). @throws {BackupError} */
export async function readBackupFile(file) {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzipped = head[0] === 0x1f && head[1] === 0x8b;
  const text = gzipped ? await gunzip(new Blob([file], { type: 'application/gzip' })) : await file.text();
  return parseBackup(text);
}

/** True when no workout is being recorded (restoring then would fight the live journal). */
export async function canRestore() {
  const status = await tracker.getStatus().catch(() => ({ state: 'idle' }));
  return status.state === 'idle';
}

/** Restore a parsed backup, then bring settings, routines and widgets in line with it. */
export async function applyBackup(backup, { onProgress } = {}) {
  const result = await restoreBackup(backup, {
    importItems,
    saveCourse,
    setPref: (key, value) => Preferences.set({ key, value }),
    onProgress,
  });
  await loadSettings();
  await rebuildRoutineModel().catch((e) => console.error('Routine model rebuild failed', e));
  await tracker.refreshWidgets().catch(() => {});
  window.dispatchEvent(new CustomEvent('workouts-changed'));
  return result;
}

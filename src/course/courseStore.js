// Courses opened in View, kept apart from workouts so they never reach History, Insights,
// routines or goal prediction. Each course is its original file text under
// Directory.Data/courses/<id>.gpx (Capacitor Filesystem; IndexedDB in the browser), with a
// small index in Preferences for the list.

import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Preferences } from '@capacitor/preferences';
import { previewPolyline } from '../stats/summary.js';
import { courseId, parseCourse } from './courseFile.js';

const INDEX_KEY = 'courses.v1';
const path = (id) => `courses/${id}.gpx`;

async function readIndex() {
  try {
    const { value } = await Preferences.get({ key: INDEX_KEY });
    const list = value ? JSON.parse(value) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

const writeIndex = (list) => Preferences.set({ key: INDEX_KEY, value: JSON.stringify(list) });

/** Courses, newest first. */
export async function listCourses() {
  return (await readIndex()).sort((a, b) => b.addedAt - a.addedAt);
}

/**
 * Parse and keep a course file. Opening the same file again returns the saved course
 * (moved to the top of the list).
 * @throws {CourseError} when the file has no usable route
 */
export async function saveCourse(text, filename = '') {
  const parsed = parseCourse(text, filename);
  const id = courseId(text);
  const list = await readIndex();
  const existing = list.find((c) => c.id === id);
  if (existing) {
    existing.addedAt = Date.now();
    await writeIndex(list);
    return existing;
  }
  await Filesystem.writeFile({ path: path(id), data: text, directory: Directory.Data, encoding: Encoding.UTF8, recursive: true });
  const entry = {
    id,
    name: parsed.name,
    sharedBy: parsed.sharedBy,
    activity: parsed.activity,
    trimmed: parsed.trimmed,
    filename,
    distance: parsed.summary.distance,
    gain: parsed.summary.elevGain,
    loss: parsed.summary.elevLoss,
    preview: previewPolyline(parsed.track, 60),
    addedAt: Date.now(),
  };
  list.push(entry);
  await writeIndex(list);
  return entry;
}

/** A saved course, parsed: {entry, name, sharedBy, activity, track, summary}, or null. */
export async function getCourse(id) {
  const entry = (await readIndex()).find((c) => c.id === id);
  if (!entry) return null;
  const { data } = await Filesystem.readFile({ path: path(id), directory: Directory.Data, encoding: Encoding.UTF8 });
  const text = typeof data === 'string' ? data : await data.text();
  return { entry, ...parseCourse(text, entry.filename) };
}

export async function deleteCourse(id) {
  await writeIndex((await readIndex()).filter((c) => c.id !== id));
  await Filesystem.deleteFile({ path: path(id), directory: Directory.Data }).catch(() => {});
}

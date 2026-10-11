// View: open a course someone shared (or any GPX/GeoJSON route) and the list of courses
// opened before. Nothing here is a workout and nothing is recorded.

import { activity as activityProfile } from '../activities.js';
import { CourseError } from '../course/courseFile.js';
import { deleteCourse, listCourses, saveCourse } from '../course/courseStore.js';
import { navigate } from '../router.js';
import { settings } from '../settings.js';
import { confirmDialog } from '../ui/dialog.js';
import { Disposer, escapeHtml } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { routeThumbSVG } from '../ui/thumb.js';
import { toast } from '../ui/toast.js';
import { altitudeUnit, altitudeValue, formatDistance } from '../units.js';

/** "Shared by AR · 4.71 km · +64 m" */
export function courseMeta(c, units) {
  const climb = `+${Math.round(altitudeValue(c.gain ?? 0, units)).toLocaleString()} ${altitudeUnit(units)}`;
  return [c.sharedBy ? `Shared by ${c.sharedBy}` : null, formatDistance(c.distance, units), climb].filter(Boolean).join(' · ');
}

/** Read a picked file and keep it as a course; returns the saved entry or null. */
export async function openCourseFile(file) {
  if (!file) return null;
  if (file.size > 20 * 1024 * 1024) {
    toast('That file is too large to be a course');
    return null;
  }
  try {
    return await saveCourse(await file.text(), file.name);
  } catch (e) {
    if (!(e instanceof CourseError)) console.error(e);
    toast(e instanceof CourseError ? e.message : `Could not open ${file.name}`);
    return null;
  }
}

export async function mount(root, params, query, ctx) {
  const d = new Disposer();
  const units = settings().units;

  root.innerHTML = `
    <div class="screen" data-activity="view">
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <h1>View</h1>
      </header>
      <div class="body">
        <div class="page">
          <p class="dim view-intro">Explore a course someone shared with you on the map and in 3D. Courses have the route and its altitude only, with no times or speeds. Nothing is recorded.</p>
          <button class="btn primary open-course" data-act="open">${icons.folder}Open a course file</button>
          <input type="file" accept=".gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json,application/octet-stream" hidden />
          <div data-slot="list"></div>
        </div>
      </div>
    </div>`;

  const back = () => {
    if (history.length > 1) history.back();
    else navigate('/', { replace: true });
    return true;
  };
  root.querySelector('[data-act="back"]').addEventListener('click', back);
  ctx?.setBackHandler(back);

  const input = root.querySelector('input[type="file"]');
  root.querySelector('[data-act="open"]').addEventListener('click', () => input.click());
  input.addEventListener('change', async () => {
    const entry = await openCourseFile(input.files?.[0]);
    input.value = '';
    if (entry) navigate(`/course/${encodeURIComponent(entry.id)}`);
  });

  const list = root.querySelector('[data-slot="list"]');
  async function render() {
    const courses = await listCourses();
    if (!courses.length) {
      list.innerHTML = `<div class="empty">${icons.route}<div>No courses yet.<br><small>When someone shares a course, save the .gpx file, then open it here.</small></div></div>`;
      return;
    }
    list.innerHTML = `
      <div class="section-title">Your courses</div>
      <div class="workout-list">${courses
        .map(
          (c) => `
          <div class="workout-item card course-item" data-activity="${c.activity ? activityProfile(c.activity).id : 'view'}">
            <a class="course-link" href="#/course/${encodeURIComponent(c.id)}">
              ${routeThumbSVG(c.preview)}
              <div style="min-width:0">
                <div class="title">${escapeHtml(c.name)}</div>
                <div class="meta num">${escapeHtml(courseMeta(c, units))}</div>
              </div>
            </a>
            <button class="icon-btn" data-delete="${escapeHtml(c.id)}" aria-label="Remove ${escapeHtml(c.name)}">${icons.trash}</button>
          </div>`
        )
        .join('')}</div>`;
    list.querySelectorAll('[data-delete]').forEach((b) =>
      b.addEventListener('click', async () => {
        const c = courses.find((x) => x.id === b.dataset.delete);
        const ok = await confirmDialog({ title: 'Remove this course?', message: `“${c.name}” will be removed from View.`, confirmLabel: 'Remove', danger: true });
        if (!ok) return;
        await deleteCourse(c.id);
        render();
      })
    );
  }
  await render();
  return () => d.dispose();
}

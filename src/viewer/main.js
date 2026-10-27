// Locale Viewer: a standalone web page that opens a shared course (a .gpx or GeoJSON file,
// or a course link, #c=…) on the Map and in 3D, using the app's own course parser and views.
// Everything happens in the browser: files are read locally and a link's course lives in
// the URL fragment, which browsers never send to the server.

import '@fontsource-variable/google-sans';
import '../styles/app.css';
import './viewer.css';
import { activity as activityProfile } from '../activities.js';
import { CourseError, courseFilename, parseCourse } from '../course/courseFile.js';
import { CourseLinkError, LINK_PARAM, MAX_LINK_CHARS, decodeCourseLink, encodeCourseLink } from '../course/courseLink.js';
import { escapeHtml } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { formatAltitude, formatDistance } from '../units.js';

const PREFS_KEY = 'viewer.prefs.v1';
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const REPO_URL = 'https://github.com/andrewrigney1975-cpu/ar-localetracker';
const download = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M5 21h14"/></svg>';
const TABS = [
  ['map', 'Map'],
  ['3d', '3D'],
];

// ---- Preferences (this browser only) ---------------------------------------------------------

function defaultUnits() {
  const region = (navigator.language || '').split('-')[1]?.toUpperCase();
  return ['US', 'LR', 'MM'].includes(region) ? 'imperial' : 'metric';
}

function loadPrefs() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') ?? {};
  } catch {
    // Storage blocked: defaults for this visit.
  }
  return { units: defaultUnits(), mapStyle: 'streets', map3d: true, smooth3d: true, exaggeration: 'auto', ...saved };
}

const prefs = loadPrefs();

function setPref(patch) {
  Object.assign(prefs, patch);
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Per-visit only.
  }
}

// ---- State -----------------------------------------------------------------------------------

const app = document.getElementById('app');
/** {course, gpx, link} for what is on screen, or null on the landing page. */
let current = null;
let tab = 'map';
let disposeTab = null;

function showLanding(error = null) {
  disposeTab?.();
  disposeTab = null;
  current = null;
  document.title = 'Locale Viewer';
  app.dataset.activity = 'view';
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <span class="viewer-logo">${icons.logo}</span>
        <h1>Locale Viewer</h1>
      </header>
      <div class="body">
        <div class="page viewer-landing">
          <span class="viewer-hero">${icons.route}</span>
          <h2>Explore a shared course</h2>
          <p class="dim">Open a course on a map and in 3D, with its elevation profile. A course is a route and its altitude, with no times, speeds or heart rate.</p>
          ${error ? `<p class="viewer-error">${icons.warning}<span>${escapeHtml(error)}</span></p>` : ''}
          <button class="btn primary" data-act="open">${icons.folder}Open a course file</button>
          <p class="dim viewer-hint">or drop a .gpx or GeoJSON file anywhere on this page</p>
          <p class="viewer-privacy">${icons.info}<span>Files open in your browser and are never uploaded. A course link carries the course itself, after the # in the address, which browsers don't send to any server.</span></p>
          <p class="dim viewer-foot">Courses come from <a href="${REPO_URL}">Locale Exercise Tracker</a> for Android: on a workout, choose Share → Share course. Routes from other apps (GPX tracks and routes, GeoJSON lines) open too.</p>
        </div>
      </div>
    </div>`;
  app.querySelector('[data-act="open"]').addEventListener('click', pickFile);
}

function statsLine(sm) {
  const u = prefs.units;
  return [
    formatDistance(sm.distance, u),
    `+${formatAltitude(sm.elevGain, u)}`,
    `−${formatAltitude(sm.elevLoss, u)}`,
    sm.minAlt != null ? `${formatAltitude(sm.minAlt, u, false)}–${formatAltitude(sm.maxAlt, u)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function showCourse() {
  const { course } = current;
  const act = course.activity ? activityProfile(course.activity) : null;
  document.title = `${course.name} · Locale Viewer`;
  app.dataset.activity = act?.id ?? 'view';
  const by = [course.sharedBy ? `Shared by ${course.sharedBy}` : act ? `${act.label} course` : 'Course', course.trimmed ? 'start and finish hidden' : null].filter(Boolean).join(' · ');
  app.innerHTML = `
    <div class="screen">
      <header class="topbar">
        <button class="icon-btn viewer-logo" data-act="home" aria-label="Locale Viewer home">${icons.logo}</button>
        <h1>${escapeHtml(course.name)}</h1>
        <select class="select viewer-units" data-ref="units" aria-label="Units">
          <option value="metric">km</option>
          <option value="imperial">mi</option>
        </select>
        <button class="icon-btn" data-act="open" aria-label="Open another course" title="Open another course">${icons.folder}</button>
        <button class="icon-btn" data-act="download" aria-label="Download .gpx" title="Download .gpx">${download}</button>
        <button class="icon-btn" data-act="share" aria-label="Share link" title="Share link">${icons.share}</button>
      </header>
      <div class="detail">
        <div class="detail-head">
          <span class="activity-badge">${act ? act.icon : icons.route}</span>
          <div class="meta">${escapeHtml(by)}<br><span class="num" data-ref="stats">${escapeHtml(statsLine(course.summary))}</span></div>
        </div>
        <div class="tabs viewer-tabs" role="tablist">
          ${TABS.map(([id, label]) => `<button role="tab" data-tab="${id}">${label}</button>`).join('')}
        </div>
        <div class="tab-panel fill" role="tabpanel"></div>
      </div>
    </div>`;
  const units = app.querySelector('[data-ref="units"]');
  units.value = prefs.units;
  units.addEventListener('change', () => {
    setPref({ units: units.value });
    app.querySelector('[data-ref="stats"]').textContent = statsLine(course.summary);
    showTab(tab);
  });
  app.querySelector('[data-act="home"]').addEventListener('click', () => {
    history.pushState(null, '', location.pathname + location.search);
    showLanding();
  });
  app.querySelector('[data-act="open"]').addEventListener('click', pickFile);
  app.querySelector('[data-act="download"]').addEventListener('click', downloadGPX);
  app.querySelector('[data-act="share"]').addEventListener('click', shareLink);
  app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  showTab(tab);
}

async function showTab(id) {
  tab = id;
  const panel = app.querySelector('.tab-panel');
  app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === id)));
  disposeTab?.();
  disposeTab = null;
  panel.innerHTML = '<div class="saving-overlay"><div class="spinner"></div></div>';
  const { course } = current;
  const workout = { id: 'viewer', name: course.name, activity: course.activity, summary: course.summary };
  const shown = current;
  try {
    if (id === 'map') {
      const { mountMapView } = await import('../map/mapView.js');
      if (tab !== id || current !== shown) return;
      disposeTab = mountMapView(panel, {
        workout,
        track: course.track,
        units: prefs.units,
        course: true,
        styleId: prefs.mapStyle,
        onStyleChange: (mapStyle) => setPref({ mapStyle }),
      });
    } else {
      const { mountView3D } = await import('../view3d/view3d.js');
      if (tab !== id || current !== shown) return;
      disposeTab = mountView3D(panel, {
        workout,
        track: course.track,
        units: prefs.units,
        course: true,
        exaggeration: prefs.exaggeration,
        mapGround: prefs.map3d,
        mapStyle: prefs.mapStyle,
        onMapGroundChange: (map3d) => setPref({ map3d }),
        smooth: prefs.smooth3d,
        onSmoothChange: (smooth3d) => setPref({ smooth3d }),
      });
    }
  } catch (e) {
    console.error(e);
    panel.innerHTML = `<div class="empty">${icons.warning}<div>Could not display this view.<br><small>${escapeHtml(e?.message ?? e)}</small></div></div>`;
  }
}

// ---- Opening ---------------------------------------------------------------------------------

/** Show a course from GPX/GeoJSON text; `link` is its fragment value when known. */
async function openText(text, filename, link = null) {
  const course = parseCourse(text, filename);
  if (!link) {
    try {
      link = await encodeCourseLink(course);
    } catch (e) {
      console.warn('Viewer: no link for this course', e);
    }
  }
  const fits = link && link.length <= MAX_LINK_CHARS;
  // The address bar is the share link, so reloading or bookmarking keeps the course.
  const url = `${location.pathname}${location.search}${fits ? `#${LINK_PARAM}=${link}` : ''}`;
  if (`${location.pathname}${location.search}${location.hash}` !== url) history.pushState(null, '', url);
  current = { course, gpx: text, link: fits ? link : null };
  tab = 'map';
  showCourse();
}

async function openFile(file) {
  if (!file) return;
  if (file.size > MAX_FILE_BYTES) {
    toast('That file is too large to be a course');
    return;
  }
  try {
    await openText(await file.text(), file.name);
  } catch (e) {
    if (!(e instanceof CourseError)) console.error(e);
    toast(e instanceof CourseError ? e.message : `Could not open ${file.name}`);
  }
}

function pickFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.gpx,.geojson,.json,application/gpx+xml,application/geo+json,application/json';
  input.addEventListener('change', () => openFile(input.files?.[0]));
  input.click();
}

/** Open the course in the address (#c=…), or show the landing page. */
async function route() {
  const value = new URLSearchParams(location.hash.slice(1)).get(LINK_PARAM);
  if (!value) {
    if (current || !app.firstChild) showLanding();
    return;
  }
  if (current?.link === value) return;
  try {
    await openText(await decodeCourseLink(value), '', value);
  } catch (e) {
    if (!(e instanceof CourseLinkError || e instanceof CourseError)) console.error(e);
    showLanding(e instanceof CourseLinkError || e instanceof CourseError ? e.message : 'This course link could not be opened.');
  }
}

// ---- Sharing ---------------------------------------------------------------------------------

async function shareLink() {
  if (!current.link) {
    toast('This course is too detailed for a link. Share the .gpx file instead.', 4000);
    return;
  }
  const url = location.href;
  const title = current.course.name;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  } catch (e) {
    if (!/abort|cancel/i.test(String(e?.name ?? e?.message ?? e))) toast('Could not copy the link');
  }
}

function downloadGPX() {
  const { course, gpx } = current;
  const isGPX = /^\s*</.test(gpx);
  const name = courseFilename(course.sharedBy ?? '', course.name).replace(/\.gpx$/, isGPX ? '.gpx' : '.geojson');
  const url = URL.createObjectURL(new Blob([gpx], { type: isGPX ? 'application/gpx+xml' : 'application/geo+json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ---- Drag and drop ---------------------------------------------------------------------------

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (dragDepth++ === 0) document.body.classList.add('viewer-dropping');
});
window.addEventListener('dragover', (e) => {
  if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
  if (dragDepth > 0 && --dragDepth === 0) document.body.classList.remove('viewer-dropping');
});
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('viewer-dropping');
  openFile(e.dataTransfer.files?.[0]);
});

window.addEventListener('popstate', route);
route();

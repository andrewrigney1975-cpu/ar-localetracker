import '@fontsource-variable/google-sans';
import './styles/app.css';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { requestPersistence } from './db/idb.js';
import { useBackend } from './db/workouts.js';
import { currentPath, currentView, navigate, route, startRouter } from './router.js';
import { syncWorkouts } from './services/sync.js';
import { getRoutineModel, scheduleRoutineRebuild } from './insights/model.js';
import { loadSettings } from './settings.js';
import { tracker } from './tracker/client.js';
import { closeTopDialog } from './ui/dialog.js';
import { $, el } from './ui/dom.js';
import { icons } from './ui/icons.js';

route('/', () => import('./views/home.js'), { tabs: true });
route('/history', () => import('./views/history.js'), { tabs: true });
route('/settings', () => import('./views/settings.js'), { tabs: true });
route('/live', () => import('./views/live.js'));
route('/live/:activity', () => import('./views/live.js'));
route('/workout/:id', () => import('./views/detail.js'));
route('/position', () => import('./views/position.js'));

const TABS = [
  { path: '/', label: 'Track', icon: icons.home },
  { path: '/history', label: 'History', icon: icons.history },
  { path: '/settings', label: 'Settings', icon: icons.settings },
];

function renderTabbar(path, opts) {
  const bar = $('.tabbar');
  bar.hidden = !opts.tabs;
  bar.innerHTML = TABS.map(
    (t) => `<a href="#${t.path}" ${t.path === path ? 'aria-current="page"' : ''}>${t.icon}<span>${t.label}</span></a>`
  ).join('');
}

/**
 * Android: move workouts from IndexedDB to SQLite once, then use SQLite. If anything fails,
 * stay on IndexedDB for this session and retry next launch (docs/plans/sqlite-migration.md).
 */
async function initStorage() {
  if (!Capacitor.isNativePlatform()) return;
  const [native, idb, { migrateIndexedDbToNative, cleanupIndexedDb }] = await Promise.all([
    import('./db/nativeStore.js'),
    import('./db/idbStore.js'),
    import('./db/migrate.js'),
  ]);
  let notice = null;
  const slow = setTimeout(() => {
    notice = el('<div class="saving-overlay"><div class="spinner"></div><div>Updating your workouts…</div></div>');
    document.body.appendChild(notice);
  }, 300);
  try {
    const res = await migrateIndexedDbToNative({ source: idb, target: native, saveItem: native.saveItem });
    if (res.status === 'migrated') console.info(`Moved ${res.count} workouts to SQLite`);
    useBackend(native, 'sqlite');
  } catch (e) {
    console.error('Storage migration failed; using IndexedDB this session', e);
    return;
  } finally {
    clearTimeout(slow);
    notice?.remove();
  }
  cleanupIndexedDb({
    target: native,
    deleteDatabase: () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase('locale');
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
        req.onblocked = () => reject(new Error('IndexedDB delete blocked'));
      }),
  }).catch((e) => console.warn('IndexedDB cleanup deferred', e));
}

async function boot() {
  // Canvas text (profile, 3D markers) needs the bundled font before first draw.
  await Promise.race([document.fonts.load('400 16px "Google Sans Variable"'), new Promise((r) => setTimeout(r, 1500))]).catch(() => {});
  await loadSettings();
  requestPersistence();
  await initStorage();
  // One-time sample workout (City2Surf). Loaded lazily so the course data stays out of the main bundle.
  await import('./seed/seedDefaults.js').then((m) => m.seedDefaultWorkouts()).catch((e) => console.error(e));
  startRouter($('#view'), renderTabbar);

  App.addListener('backButton', () => {
    if (closeTopDialog()) return;
    const view = currentView();
    if (view?.onBack && view.onBack() !== false) return;
    if (currentPath() !== '/') {
      if (history.length > 1) history.back();
      else navigate('/', { replace: true });
    } else {
      App.minimizeApp();
    }
  });
  App.addListener('resume', () => syncWorkouts());
  // Saved natively (e.g. stopped from the watch or notification): refresh lists.
  tracker.on('saved', () => window.dispatchEvent(new CustomEvent('workouts-changed')));
  // Keep the learned routines (goal prediction) in step with the workout list.
  window.addEventListener('workouts-changed', () => scheduleRoutineRebuild());
  // A workout started outside the app (widget, watch, notification) while it's open: show it.
  tracker.on('state', (ev) => {
    if (ev.reason === 'start' && !currentPath().startsWith('/live')) navigate('/live');
  });

  // If a workout is running (app reopened from the notification), jump straight to it.
  const status = await tracker.getStatus().catch(() => ({ state: 'idle' }));
  if (status.state !== 'idle' && currentPath() === '/') navigate('/live');
  await syncWorkouts();
  getRoutineModel().catch((e) => console.error(e));
}

boot();

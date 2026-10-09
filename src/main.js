import './styles/app.css';
import { App } from '@capacitor/app';
import { activity } from './activities.js';
import { requestPersistence } from './db/idb.js';
import { currentPath, currentView, navigate, route, startRouter } from './router.js';
import { finalizeJournal, recoverJournals } from './services/workoutService.js';
import { loadSettings, settings } from './settings.js';
import { tracker } from './tracker/client.js';
import { choiceDialog, closeTopDialog } from './ui/dialog.js';
import { $ } from './ui/dom.js';
import { icons } from './ui/icons.js';
import { toast } from './ui/toast.js';
import { formatClock, formatDate } from './units.js';

route('/', () => import('./views/home.js'), { tabs: true });
route('/history', () => import('./views/history.js'), { tabs: true });
route('/settings', () => import('./views/settings.js'), { tabs: true });
route('/live', () => import('./views/live.js'));
route('/live/:activity', () => import('./views/live.js'));
route('/workout/:id', () => import('./views/detail.js'));

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

async function handleRecovery() {
  try {
    const { imported, interrupted } = await recoverJournals();
    if (imported.length) {
      toast(imported.length === 1 ? `Saved ${imported[0].name}` : `Saved ${imported.length} workouts`);
      window.dispatchEvent(new CustomEvent('workouts-changed'));
    }
    for (const j of interrupted) {
      const status = await tracker.getStatus();
      const meta = j.meta ?? {};
      const label = activity(meta.activity).label;
      const when = meta.startedAt ? `${formatDate(meta.startedAt)} ${formatClock(meta.startedAt)}` : 'earlier';
      const choice = await choiceDialog({
        title: 'Interrupted workout',
        message: `A ${label.toLowerCase()} started ${when} was interrupted before it was stopped.`,
        dismissable: false,
        options: [
          { id: 'discard', label: 'Discard', style: 'ghost' },
          ...(status.state === 'idle' ? [{ id: 'continue', label: 'Continue', style: 'ghost' }] : []),
          { id: 'save', label: 'Save', style: 'primary' },
        ],
      });
      if (choice === 'save') {
        const w = await finalizeJournal(j.workoutId);
        if (w) {
          toast(`Saved ${w.name}`);
          window.dispatchEvent(new CustomEvent('workouts-changed'));
        } else {
          await tracker.deleteJournal(j.workoutId);
          toast('Workout had no GPS points and was discarded');
        }
      } else if (choice === 'continue') {
        const s = settings();
        await tracker.start({
          workoutId: j.workoutId,
          activity: meta.activity ?? 'run',
          autoPause: s.autoPause[meta.activity] ?? false,
          units: s.units,
          resume: true,
        });
        navigate('/live');
      } else if (choice === 'discard') {
        await tracker.deleteJournal(j.workoutId);
      }
    }
  } catch (e) {
    console.error('Recovery failed', e);
  }
}

async function boot() {
  await loadSettings();
  requestPersistence();
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
  App.addListener('resume', handleRecovery);

  // If a workout is running (app reopened from the notification), jump straight to it.
  const status = await tracker.getStatus().catch(() => ({ state: 'idle' }));
  if (status.state !== 'idle' && currentPath() === '/') navigate('/live');
  await handleRecovery();
}

boot();

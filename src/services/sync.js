// Bring the workout list up to date with what happened outside the app's view: workouts
// stopped from the watch, a widget or the notification (saved natively, or left as journals
// to import), and interrupted recordings the user must decide about.

import { activity } from '../activities.js';
import { navigate } from '../router.js';
import { settings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { choiceDialog } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { formatClock, formatDate } from '../units.js';
import { finalizeJournal, recoverJournals } from './workoutService.js';

let inFlight = null;

/**
 * Import finished journals, ask about interrupted ones, then tell every list to re-read
 * storage (workouts saved natively while the WebView was suspended never sent an event).
 * Concurrent calls (app resume + pull-to-refresh) share one run.
 * @returns {Promise<{imported: number}>}
 */
export function syncWorkouts() {
  inFlight ??= run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run() {
  let count = 0;
  try {
    const { imported, interrupted } = await recoverJournals();
    count = imported.length;
    if (imported.length) toast(imported.length === 1 ? `Saved ${imported[0].name}` : `Saved ${imported.length} workouts`);
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
          count++;
          toast(`Saved ${w.name}`);
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
    console.error('Sync failed', e);
  }
  window.dispatchEvent(new CustomEvent('workouts-changed'));
  return { imported: count };
}

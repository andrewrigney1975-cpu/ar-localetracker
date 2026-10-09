import { App } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { activity as activityProfile } from '../activities.js';
import { navigate } from '../router.js';
import { finalizeJournal, newWorkoutId } from '../services/workoutService.js';
import { settings, updateSettings } from '../settings.js';
import { verticalThreshold } from '../stats/summary.js';
import { parseJournal } from '../tracker/journal.js';
import { tracker } from '../tracker/client.js';
import { choiceDialog, confirmDialog } from '../ui/dialog.js';
import { Disposer, el } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import {
  altitudeUnit,
  altitudeValue,
  distanceUnit,
  distanceValue,
  formatCoord,
  formatDuration,
  formatPace,
  headingCardinal,
  paceUnit,
  speedUnit,
  speedValue,
} from '../units.js';

const HOLD_MS = 1000;

/** Incremental hysteresis climb counter (same algorithm as stats/summary.js). */
class ClimbCounter {
  constructor(threshold) {
    this.th = threshold;
    this.reset();
  }
  reset() {
    this.gain = 0;
    this.ref = null;
    this.dir = 0;
  }
  push(a) {
    if (!Number.isFinite(a)) return;
    if (this.ref == null) {
      this.ref = a;
      return;
    }
    if (this.dir === 1) {
      if (a > this.ref) {
        this.gain += a - this.ref;
        this.ref = a;
      } else if (this.ref - a >= this.th) {
        this.ref = a;
        this.dir = -1;
      }
    } else if (this.dir === -1) {
      if (a < this.ref) this.ref = a;
      else if (a - this.ref >= this.th) {
        this.gain += a - this.ref;
        this.ref = a;
        this.dir = 1;
      }
    } else if (a - this.ref >= this.th) {
      this.gain += a - this.ref;
      this.ref = a;
      this.dir = 1;
    } else if (this.ref - a >= this.th) {
      this.ref = a;
      this.dir = -1;
    }
  }
}

export async function mount(root, params, _query, ctx) {
  const d = new Disposer();
  const s = settings();
  const units = s.units;

  let status = await tracker.getStatus().catch(() => ({ state: 'idle' }));
  const active = status.state !== 'idle';
  if (!active && !params.activity) {
    navigate('/', { replace: true });
    return null;
  }
  const act = activityProfile(active ? status.activity : params.activity);
  let phase = active ? status.state : 'ready';
  let statusAt = performance.now();
  let compass = null;
  let gnss = { satsUsed: status.satsUsed ?? 0 };
  let speedMode = s.liveSpeedMode[act.id] ?? act.liveSpeedMode;
  let busy = false;
  const climb = new ClimbCounter(verticalThreshold(Boolean(status.hasBarometer ?? true)));

  root.innerHTML = `
    <div class="screen" data-activity="${act.id}">
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <h1>${act.label}</h1>
        <span class="pill" data-ref="pill"><span class="dot"></span><span data-ref="pillText"></span></span>
      </header>
      <div class="body" style="overflow:hidden">
        <div class="live">
          <div class="live-status">
            <span class="gps-quality"><span class="gps-bars" data-ref="bars"><i></i><i></i><i></i><i></i></span><span data-ref="gpsText">Searching for GPS…</span></span>
            <span class="gps-quality" data-ref="sats"></span>
          </div>
          <div class="metrics">
            <div class="metric hero"><label>Elapsed time</label><div class="value" data-ref="elapsed">0:00</div></div>
            <div class="metric"><label>Distance</label><div class="value" data-ref="distance">0.00<small>${distanceUnit(units)}</small></div></div>
            <div class="metric"><label data-ref="speedLabel"></label><button class="value" data-ref="speed" aria-label="Toggle speed or pace"></button></div>
            <div class="metric"><label data-ref="headingLabel">Heading</label><div class="value heading-value"><span data-ref="headingArrow">${icons.arrowUp.replace('<svg', '<svg class="heading-arrow"')}</span><span data-ref="heading">–</span></div></div>
            <div class="metric"><label>Altitude</label><div class="value" data-ref="altitude">–</div><div class="dim num" style="font-size:.8rem" data-ref="climb"></div></div>
            <div class="metric wide coords"><label>Location</label><div class="value"><span data-ref="lat">–</span><span data-ref="lon">–</span></div></div>
          </div>
          <div>
            <div class="live-controls" data-ref="controls"></div>
            <div class="live-hint" data-ref="hint"></div>
          </div>
        </div>
      </div>
    </div>`;

  const ref = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
  const headingSvg = ref.headingArrow.querySelector('svg');

  // ---- Rendering --------------------------------------------------------------------------
  const elapsedMs = () => (status.elapsedMs ?? 0) + (phase === 'recording' ? performance.now() - statusAt : 0);

  function renderPill() {
    const map = { ready: ['Ready', ''], recording: ['Recording', 'recording'], paused: ['Paused', 'paused'], autopaused: ['Auto-paused', 'paused'], saving: ['Saving', ''] };
    const [txt, cls] = map[phase] ?? ['', ''];
    ref.pill.className = `pill ${cls}`;
    ref.pillText.textContent = txt;
  }

  function renderTimer() {
    ref.elapsed.textContent = formatDuration(elapsedMs() / 1000);
  }

  function renderMetrics() {
    const last = status.last;
    ref.distance.innerHTML = `${distanceValue(status.distance ?? 0, units).toFixed(2)}<small>${distanceUnit(units)}</small>`;
    const v = last?.speed;
    if (speedMode === 'pace') {
      ref.speedLabel.textContent = 'Pace';
      ref.speed.innerHTML = `${formatPace(v, units, false)}<small>${paceUnit(units)}</small>`;
    } else {
      ref.speedLabel.textContent = 'Speed';
      ref.speed.innerHTML = `${Number.isFinite(v) ? speedValue(v, units).toFixed(1) : '–'}<small>${speedUnit(units)}</small>`;
    }
    // GNSS course is reliable when moving; the compass is better when slow or stopped.
    let heading = null;
    let src = '';
    if (last && Number.isFinite(last.bearing) && (last.speed ?? 0) >= 1) {
      heading = last.bearing;
      src = 'GPS';
    } else if (compass != null) {
      heading = compass;
      src = 'Compass';
    }
    ref.headingLabel.textContent = src ? `Heading · ${src}` : 'Heading';
    if (heading != null) {
      ref.heading.innerHTML = `${Math.round(heading)}°<small>${headingCardinal(heading)}</small>`;
      headingSvg.style.transform = `rotate(${heading}deg)`;
    } else ref.heading.textContent = '–';
    if (last && Number.isFinite(last.altitude)) {
      ref.altitude.innerHTML = `${Math.round(altitudeValue(last.altitude, units)).toLocaleString()}<small>${altitudeUnit(units)}</small>`;
    }
    ref.climb.textContent = phase !== 'ready' ? `↑ ${Math.round(altitudeValue(climb.gain, units))} ${altitudeUnit(units)} climbed` : '';
    ref.lat.textContent = formatCoord(last?.lat, 'lat');
    ref.lon.textContent = formatCoord(last?.lon, 'lon');

    const acc = last?.accuracy;
    let level = 0;
    if (Number.isFinite(acc)) level = acc <= 5 ? 4 : acc <= 10 ? 3 : acc <= 20 ? 2 : 1;
    ref.bars.dataset.level = String(level);
    ref.gpsText.textContent = Number.isFinite(acc) ? `GPS ±${Math.round(acc)} m` : 'Searching for GPS…';
    ref.sats.textContent = gnss.satsUsed ? `${gnss.satsUsed} satellites` : '';
    if (phase === 'ready') ref.hint.textContent = level >= 3 ? 'GPS ready' : level > 0 ? 'Weak GPS signal: you can start, but accuracy may suffer' : 'Waiting for a GPS fix…';
  }

  function holdButton(onDone) {
    const btn = el(`<button class="round-btn stop" aria-label="Hold to stop">${icons.stop}
      <svg class="ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="47" pathLength="100" stroke-dasharray="0 100"/></svg></button>`);
    const circle = btn.querySelector('circle');
    let start = 0;
    let raf = 0;
    const reset = () => {
      cancelAnimationFrame(raf);
      start = 0;
      circle.setAttribute('stroke-dasharray', '0 100');
    };
    const tick = () => {
      const f = Math.min(1, (performance.now() - start) / HOLD_MS);
      circle.setAttribute('stroke-dasharray', `${f * 100} 100`);
      if (f >= 1) {
        reset();
        navigator.vibrate?.(30);
        onDone();
      } else raf = requestAnimationFrame(tick);
    };
    btn.addEventListener('pointerdown', (e) => {
      btn.setPointerCapture(e.pointerId);
      start = performance.now();
      raf = requestAnimationFrame(tick);
    });
    const cancel = () => {
      if (start && performance.now() - start < HOLD_MS) {
        ref.hint.textContent = 'Hold the stop button to finish';
      }
      reset();
    };
    btn.addEventListener('pointerup', cancel);
    btn.addEventListener('pointercancel', cancel);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
    // Keyboard / accessibility: Enter or Space confirms via dialog.
    btn.addEventListener('keydown', async (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (await confirmDialog({ title: 'Finish workout?', confirmLabel: 'Finish' })) onDone();
    });
    d.add(reset);
    return btn;
  }

  function labelled(btn, text) {
    const wrap = el('<div class="round-btn-label"></div>');
    wrap.append(btn, el(`<span>${text}</span>`));
    return wrap;
  }

  function renderControls() {
    const c = ref.controls;
    c.replaceChildren();
    if (phase === 'ready') {
      const start = el(`<button class="round-btn big primary" aria-label="Start ${act.label}"><span class="start-label">START</span></button>`);
      start.addEventListener('click', onStart);
      c.append(start);
    } else if (phase === 'recording' || phase === 'autopaused') {
      const pause = el(`<button class="round-btn big primary" aria-label="Pause">${icons.pause}</button>`);
      pause.addEventListener('click', () => tracker.pause());
      c.append(labelled(pause, 'Pause'), labelled(holdButton(onStop), 'Hold to stop'));
      ref.hint.textContent = phase === 'autopaused' ? 'Auto-paused: resumes when you move' : '';
    } else if (phase === 'paused') {
      const resume = el(`<button class="round-btn big primary" aria-label="Resume">${icons.play}</button>`);
      resume.addEventListener('click', () => tracker.resume());
      c.append(labelled(resume, 'Resume'), labelled(holdButton(onStop), 'Hold to stop'));
      ref.hint.textContent = 'Paused: time is not counting';
    }
  }

  function renderAll() {
    renderPill();
    renderTimer();
    renderMetrics();
    renderControls();
  }

  // ---- Actions ----------------------------------------------------------------------------
  async function ensurePermissions() {
    let perms = await tracker.checkPermissions();
    if (perms.location !== 'granted') perms = await tracker.requestPermissions();
    if (perms.location !== 'granted') {
      const go = await confirmDialog({
        title: 'Location permission needed',
        message: 'Locale needs precise location to record your route. Allow "While using the app" in settings.',
        confirmLabel: 'Open settings',
      });
      if (go) await tracker.openAppSettings();
      return false;
    }
    if (perms.notifications !== 'granted') {
      toast('Notifications are off: you will not see workout controls on the lock screen');
    }
    return true;
  }

  async function checkDevice() {
    const caps = await tracker.getCapabilities();
    if (!caps.gpsEnabled) {
      const go = await confirmDialog({ title: 'Location is off', message: 'Turn on device location to track your workout.', confirmLabel: 'Open settings' });
      if (go) await tracker.openLocationSettings();
      return false;
    }
    if (!caps.ignoringBatteryOptimizations) {
      const { value } = await Preferences.get({ key: 'batteryPrompted' });
      if (!value) {
        await Preferences.set({ key: 'batteryPrompted', value: '1' });
        const choice = await choiceDialog({
          title: 'Keep tracking reliable',
          message: `Some phones (including ${caps.manufacturer}) stop apps in the background to save battery. Allow Locale to run unrestricted so your route has no gaps.`,
          options: [
            { id: 'skip', label: 'Not now' },
            { id: 'allow', label: 'Allow', style: 'primary' },
          ],
        });
        if (choice === 'allow') await tracker.requestIgnoreBatteryOptimizations();
      }
    }
    return true;
  }

  async function onStart() {
    if (busy) return;
    busy = true;
    try {
      if (!(await ensurePermissions()) || !(await checkDevice())) return;
      const workoutId = newWorkoutId();
      await tracker.start({ workoutId, activity: act.id, autoPause: Boolean(s.autoPause[act.id]), units });
      climb.reset();
      phase = 'recording';
      status = { ...status, state: 'recording', workoutId, elapsedMs: 0, distance: 0 };
      statusAt = performance.now();
      if (s.keepScreenOn) tracker.setKeepScreenOn(true);
      navigator.vibrate?.(40);
      renderAll();
    } catch (e) {
      toast(e?.message ?? 'Could not start tracking');
    } finally {
      busy = false;
    }
  }

  let finishing = false;
  async function finish(workoutId) {
    if (finishing) return;
    finishing = true;
    phase = 'saving';
    renderPill();
    const overlay = el('<div class="saving-overlay"><div class="spinner"></div><div>Saving workout…</div></div>');
    root.querySelector('.live').appendChild(overlay);
    tracker.setKeepScreenOn(false);
    try {
      const w = workoutId ? await finalizeJournal(workoutId) : null;
      window.dispatchEvent(new CustomEvent('workouts-changed'));
      if (w) navigate(`/workout/${encodeURIComponent(w.id)}`, { replace: true });
      else {
        if (workoutId) await tracker.deleteJournal(workoutId);
        toast('No GPS points were recorded, so the workout was discarded');
        navigate('/', { replace: true });
      }
    } catch (e) {
      console.error(e);
      toast('Saving failed. The workout is kept and will be retried.');
      navigate('/', { replace: true });
    }
  }

  async function onStop() {
    const res = await tracker.stop();
    await finish(res.workoutId ?? status.workoutId);
  }

  // ---- Events -----------------------------------------------------------------------------
  d.add(
    tracker.on('point', (ev) => {
      if (ev.state === 'idle' && phase !== 'ready') return; // stray warm-up fix
      status = { ...status, ...ev, last: ev.last ?? status.last };
      statusAt = performance.now();
      if (phase === 'recording' && ev.last) climb.push(ev.last.altitude);
      renderMetrics();
      renderTimer();
    })
  );
  d.add(
    tracker.on('state', (ev) => {
      const prevWorkout = status.workoutId;
      status = { ...status, ...ev };
      statusAt = performance.now();
      if (ev.state === 'idle') {
        if (phase !== 'ready' && phase !== 'saving') finish(ev.workoutId ?? prevWorkout); // stopped from the notification
        return;
      }
      if (phase !== ev.state) {
        phase = ev.state;
        renderAll();
      }
    })
  );
  d.add(
    tracker.on('gnss', (ev) => {
      gnss = ev;
      renderMetrics();
    })
  );
  d.add(
    tracker.on('heading', (ev) => {
      compass = ev.heading;
      renderMetrics();
    })
  );

  // Resync after returning from background (events are not delivered while hidden).
  const resumeHandle = App.addListener('resume', async () => {
    const st = await tracker.getStatus();
    if (st.state === 'idle') {
      if (phase !== 'ready' && phase !== 'saving') finish(status.workoutId);
      return;
    }
    status = st;
    statusAt = performance.now();
    if (phase !== st.state) {
      phase = st.state;
      renderAll();
    } else renderMetrics();
  });
  d.add(() => resumeHandle.then((h) => h.remove()));

  ref.speed.addEventListener('click', () => {
    speedMode = speedMode === 'pace' ? 'speed' : 'pace';
    updateSettings({ liveSpeedMode: { ...settings().liveSpeedMode, [act.id]: speedMode } });
    renderMetrics();
  });

  const goBack = () => {
    if (phase === 'saving') return true;
    navigate('/');
    return true;
  };
  root.querySelector('[data-act="back"]').addEventListener('click', goBack);
  ctx.setBackHandler(goBack);

  const timer = setInterval(renderTimer, 250);
  d.add(() => clearInterval(timer));

  // ---- Start-up ---------------------------------------------------------------------------
  tracker.startHeading().catch(() => {});
  d.add(() => tracker.stopHeading().catch(() => {}));

  if (active) {
    if (s.keepScreenOn) tracker.setKeepScreenOn(true);
    // Rebuild the climb counter from the journal so it survives navigation and app restarts.
    try {
      const j = parseJournal(await tracker.readJournal(status.workoutId));
      climb.th = verticalThreshold(Boolean(j.meta?.hasBarometer));
      for (const p of j.points) if (!p.p) climb.push(p.af ?? p.am ?? p.ae);
    } catch {
      /* journal not readable yet */
    }
  } else {
    const perms = await tracker.checkPermissions().catch(() => ({ location: 'prompt' }));
    if (perms.location === 'granted') {
      tracker.startWarmup().catch(() => {});
      d.add(() => tracker.stopWarmup().catch(() => {}));
    } else {
      ref.hint.textContent = 'Tap Start to allow location access';
    }
  }
  // Keep-screen-on only applies while this screen is visible.
  d.add(() => tracker.setKeepScreenOn(false));

  renderAll();
  return () => d.dispose();
}

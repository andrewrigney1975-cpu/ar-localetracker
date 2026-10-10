// Live: where am I right now? Shows position, accuracy, altitude, speed and heading from GPS,
// barometer and compass, with a small map. Records nothing: no journal, no notification.

import { App } from '@capacitor/app';
import { locationShareText } from '../export/text.js';
import { navigate } from '../router.js';
import { shareText } from '../services/share.js';
import { settings, updateSettings } from '../settings.js';
import { tracker } from '../tracker/client.js';
import { confirmDialog } from '../ui/dialog.js';
import { Disposer, el } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import {
  altitudeUnit,
  altitudeValue,
  formatClock,
  formatCoord,
  formatDMS,
  headingCardinal,
  speedUnit,
  speedValue,
} from '../units.js';

export async function mount(root, _params, _query, ctx) {
  const d = new Disposer();
  const units = settings().units;
  let dms = settings().coordFormat === 'dms';
  let fix = null; // last location event
  let fixAt = 0;
  let compass = null;
  let sats = null;
  let held = false;
  let recording = false;

  root.innerHTML = `
    <div class="screen" data-activity="live">
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <h1>Live</h1>
        <span class="pill" data-ref="pill"><span class="dot"></span><span data-ref="pillText">Not recording</span></span>
      </header>
      <div class="body">
        <div class="page live-pos">
          <div class="live-status">
            <span class="gps-quality"><span class="gps-bars" data-ref="bars"><i></i><i></i><i></i><i></i></span><span data-ref="gpsText">Searching for GPS…</span></span>
            <span class="gps-quality" data-ref="sats"></span>
          </div>
          <div class="banner warn" data-ref="perm" hidden>
            ${icons.warning}<span class="grow"><strong>Location is off</strong><span class="dim">Allow location to see where you are.</span></span>
            <button class="btn ghost" data-act="allow">Allow</button>
          </div>
          <div class="banner" data-ref="recNote" hidden>${icons.info}<span class="grow">A workout is recording, so this shows its live position.</span></div>

          <button class="metric wide coords pos-coords" data-act="format" aria-label="Coordinates. Tap to switch format.">
            <label><span>Location</span><span class="fmt-chip" data-ref="fmt"></span></label>
            <span class="value"><span data-ref="lat">–</span><span data-ref="lon">–</span></span>
          </button>

          <div class="pos-grid">
            <div class="metric"><label>Altitude</label><div class="value" data-ref="alt">–</div><div class="metric-sub" data-ref="altSub"></div></div>
            <div class="metric"><label>Speed</label><div class="value" data-ref="speed">–</div><div class="metric-sub" data-ref="speedSub"></div></div>
            <div class="metric"><label data-ref="headLabel">Heading</label><div class="value heading-value"><span>${icons.arrowUp.replace('<svg', '<svg class="heading-arrow" data-ref="arrow"')}</span><span data-ref="heading">–</span></div></div>
            <div class="metric"><label>Updated</label><div class="value" data-ref="age">–</div><div class="metric-sub" data-ref="clock"></div></div>
          </div>

          <div class="card pos-map-card" data-ref="map"></div>

          <div class="pos-actions">
            <button class="btn ghost" data-act="copy">${icons.copy}Copy</button>
            <button class="btn ghost" data-act="share">${icons.share}Share</button>
            <button class="btn primary" data-act="hold" aria-pressed="false">${icons.pause}<span>Hold</span></button>
          </div>
        </div>
      </div>
    </div>`;

  const ref = Object.fromEntries([...root.querySelectorAll('[data-ref]')].map((n) => [n.dataset.ref, n]));
  const arrow = root.querySelector('[data-ref="arrow"]');

  // ---- Rendering --------------------------------------------------------------------------
  function render() {
    ref.fmt.textContent = dms ? 'DMS' : 'Decimal';
    ref.pill.className = `pill ${held ? 'paused' : ''}`;
    ref.pillText.textContent = held ? 'Held' : recording ? 'Recording' : 'Not recording';
    const f = fix;
    if (!f) return;
    ref.lat.textContent = dms ? formatDMS(f.lat, 'lat') : formatCoord(f.lat, 'lat');
    ref.lon.textContent = dms ? formatDMS(f.lon, 'lon') : formatCoord(f.lon, 'lon');

    const acc = f.accuracy;
    const level = !Number.isFinite(acc) ? 0 : acc <= 5 ? 4 : acc <= 10 ? 3 : acc <= 20 ? 2 : 1;
    ref.bars.dataset.level = String(level);
    ref.gpsText.textContent = Number.isFinite(acc) ? `GPS ±${Math.round(acc)} m` : 'Searching for GPS…';
    ref.sats.textContent = sats ? `${sats} satellites` : '';

    if (Number.isFinite(f.altitude)) {
      ref.alt.innerHTML = `${Math.round(altitudeValue(f.altitude, units)).toLocaleString()}<small>${altitudeUnit(units)}</small>`;
      const src = f.altitudeSource === 'barometer' ? 'Barometer + GPS' : 'GPS';
      const va = Number.isFinite(f.altitudeAccuracy) ? ` · ±${Math.round(altitudeValue(f.altitudeAccuracy, units))} ${altitudeUnit(units)}` : '';
      ref.altSub.textContent = `${src}${va}${Number.isFinite(f.pressure) ? ` · ${f.pressure.toFixed(1)} hPa` : ''}`;
    }
    const v = Number.isFinite(f.speed) ? f.speed : null;
    ref.speed.innerHTML = v == null ? '–' : `${speedValue(v, units).toFixed(1)}<small>${speedUnit(units)}</small>`;
    ref.speedSub.textContent = v != null && v < 0.5 ? 'Standing still' : '';

    // GPS course when moving, compass when still (same rule as the workout screen).
    let heading = null;
    let src = '';
    if (Number.isFinite(f.bearing) && (v ?? 0) >= 1) {
      heading = f.bearing;
      src = 'GPS';
    } else if (compass != null) {
      heading = compass;
      src = 'Compass';
    }
    ref.headLabel.textContent = src ? `Heading · ${src}` : 'Heading';
    if (heading != null) {
      ref.heading.innerHTML = `${Math.round(heading)}°<small>${headingCardinal(heading)}</small>`;
      arrow.style.transform = `rotate(${heading}deg)`;
    }
    ref.clock.textContent = formatClock(f.t);
  }

  function renderAge() {
    if (!fix) return;
    const s = Math.max(0, Math.round((Date.now() - fixAt) / 1000));
    ref.age.innerHTML = held ? 'Held' : s <= 1 ? 'Now' : `${s}<small>s ago</small>`;
  }

  // ---- Map (lazy: MapLibre is large) ------------------------------------------------------
  let map = null;
  import('../map/positionMap.js')
    .then(({ createPositionMap }) => {
      if (d.disposed) return;
      map = createPositionMap(ref.map, { styleId: settings().mapStyle });
      if (fix) map.update(fix);
    })
    .catch((e) => {
      console.error(e);
      ref.map.innerHTML = '<div class="map-offline">Map unavailable</div>';
    });
  d.add(() => map?.destroy());
  d.add(() => {
    d.disposed = true;
  });

  // ---- Data -------------------------------------------------------------------------------
  d.add(
    tracker.on('point', (ev) => {
      recording = ev.state && ev.state !== 'idle';
      ref.recNote.hidden = !recording;
      if (held || !ev.last) return;
      fix = ev.last;
      fixAt = Date.now();
      map?.update(fix);
      render();
      renderAge();
    })
  );
  d.add(
    tracker.on('gnss', (ev) => {
      sats = ev.satsUsed;
      if (!held) render();
    })
  );
  d.add(
    tracker.on('heading', (ev) => {
      compass = ev.heading;
      if (!held) render();
    })
  );

  async function start() {
    let perms = await tracker.checkPermissions().catch(() => ({ location: 'prompt' }));
    ref.perm.hidden = perms.location === 'granted';
    if (perms.location !== 'granted') return;
    await tracker.startWarmup().catch((e) => toast(e?.message ?? 'Could not start GPS'));
    // While recording, the service supplies fixes; show the latest straight away.
    const st = await tracker.getStatus().catch(() => null);
    if (st?.last && st.state !== 'idle') {
      recording = true;
      ref.recNote.hidden = false;
      fix = st.last;
      fixAt = Date.now();
      render();
    }
  }

  tracker
    .startHeading()
    .then((res) => {
      if (res?.heading != null && compass == null) {
        compass = res.heading;
        render();
      }
    })
    .catch(() => {});
  d.add(() => tracker.stopHeading().catch(() => {}));
  d.add(() => tracker.stopWarmup().catch(() => {}));
  if (settings().keepScreenOn) {
    tracker.setKeepScreenOn(true);
    d.add(() => tracker.setKeepScreenOn(false));
  }
  // Re-check permission after returning from system settings.
  const resume = App.addListener('resume', start);
  d.add(() => resume.then((h) => h.remove()));

  const timer = setInterval(renderAge, 1000);
  d.add(() => clearInterval(timer));

  // ---- Actions ----------------------------------------------------------------------------
  root.querySelector('[data-act="allow"]').addEventListener('click', async () => {
    const perms = await tracker.requestPermissions();
    if (perms.location === 'granted') start();
    else if (await confirmDialog({ title: 'Location permission needed', message: 'Allow location for Locale in system settings.', confirmLabel: 'Open settings' })) {
      tracker.openAppSettings();
    }
  });

  root.querySelector('[data-act="format"]').addEventListener('click', () => {
    dms = !dms;
    updateSettings({ coordFormat: dms ? 'dms' : 'decimal' });
    render();
  });

  root.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    if (!fix) return toast('No position yet');
    const text = `${fix.lat.toFixed(6)}, ${fix.lon.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = el(`<textarea style="position:fixed;opacity:0">${text}</textarea>`);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(`Copied ${text}`);
  });

  root.querySelector('[data-act="share"]').addEventListener('click', async () => {
    if (!fix) return toast('No position yet');
    try {
      const res = await shareText({ text: locationShareText(fix, { units }), title: 'My location' });
      if (res === 'copied') toast('Location copied');
    } catch (e) {
      toast(`Sharing failed: ${e?.message ?? e}`);
    }
  });

  const holdBtn = root.querySelector('[data-act="hold"]');
  holdBtn.addEventListener('click', () => {
    held = !held;
    holdBtn.setAttribute('aria-pressed', String(held));
    holdBtn.innerHTML = held ? `${icons.play}<span>Resume</span>` : `${icons.pause}<span>Hold</span>`;
    render();
    renderAge();
  });

  const back = () => {
    navigate('/');
    return true;
  };
  root.querySelector('[data-act="back"]').addEventListener('click', back);
  ctx.setBackHandler(back);

  render();
  await start();
  return () => d.dispose();
}

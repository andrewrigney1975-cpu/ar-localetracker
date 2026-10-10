// Tracker facade: the native LocaleTracker plugin on Android, a simulator in the browser.

import { Capacitor, registerPlugin } from '@capacitor/core';
import { activity as activityProfile } from '../activities.js';
import { haversine } from '../geo/geo.js';
import { HeartModel, SyntheticRoute } from './synthetic.js';
import { settings } from '../settings.js';
import { VoiceCoach, voiceConfig } from '../voice/coach.js';

const Native = registerPlugin('LocaleTracker');

function nativeTracker() {
  return {
    isNative: true,
    async checkPermissions() {
      return Native.checkPermissions();
    },
    async requestPermissions() {
      return Native.requestPermissions({ permissions: ['location', 'notifications'] });
    },
    getCapabilities: () => Native.getCapabilities(),
    start: (opts) => Native.start(opts),
    pause: () => Native.pause(),
    resume: () => Native.resume(),
    stop: () => Native.stop(),
    getStatus: () => Native.getStatus(),
    startWarmup: () => Native.startWarmup(),
    stopWarmup: () => Native.stopWarmup(),
    startHeading: () => Native.startHeading(),
    stopHeading: () => Native.stopHeading(),
    async listJournals() {
      return (await Native.listJournals()).journals;
    },
    async readJournal(workoutId) {
      return (await Native.readJournal({ workoutId })).text;
    },
    deleteJournal: (workoutId) => Native.deleteJournal({ workoutId }),
    setKeepScreenOn: (enabled) => Native.setKeepScreenOn({ enabled }),
    speak: (text, duck = true) => Native.speak({ text, duck }),
    getWatchStatus: () => Native.getWatchStatus(),
    pinWidget: (size) => Native.pinWidget({ size }),
    requestBackgroundLocation: () => Native.requestBackgroundLocation(),
    requestIgnoreBatteryOptimizations: () => Native.requestIgnoreBatteryOptimizations(),
    openAppSettings: () => Native.openAppSettings(),
    openLocationSettings: () => Native.openLocationSettings(),
    on(event, cb) {
      const handle = Native.addListener(event, cb);
      return () => handle.then((h) => h.remove());
    },
  };
}

/**
 * Browser simulator with the same contract as the native plugin. Journals live in
 * localStorage so reloads behave like process death. `?sim=10` runs 10× faster.
 */
function simTracker() {
  const speedup = Math.max(1, Number(new URLSearchParams(location.search).get('sim')) || 1);
  const listeners = new Map();
  const emit = (name, data) => listeners.get(name)?.forEach((cb) => cb(data));
  const JKEY = (id) => `sim-journal:${id}`;
  const START = { lat: -33.8731, lon: 151.2111, alt: 32 };

  let st = idleState();
  let timer = null;
  let warmTimer = null;
  let headingTimer = null;
  let route = null;
  let heart = null;
  let prevAlt = null;
  let simClock = 0;
  let anchor = null;
  let coach = null;

  function idleState() {
    return { state: 'idle', workoutId: null, activity: null, startedAt: 0, elapsedBase: 0, runningSince: 0, distance: 0, segment: 0, seq: 0, last: null };
  }
  const append = (id, obj) => {
    try {
      localStorage.setItem(JKEY(id), (localStorage.getItem(JKEY(id)) ?? '') + JSON.stringify(obj) + '\n');
    } catch {
      /* quota */
    }
  };
  const now = () => simClock;
  const elapsed = () => st.elapsedBase + (st.state === 'recording' ? now() - st.runningSince : 0);
  const snapshot = () => ({
    state: st.state,
    workoutId: st.workoutId,
    activity: st.activity,
    startedAt: st.startedAt,
    elapsedMs: elapsed(),
    distance: st.distance,
    segment: st.segment,
    pointCount: st.seq,
    hasBarometer: true,
    satsUsed: 21,
    satsVisible: 34,
    hr: st.hr,
    last: st.last,
  });
  function setState(next, reason) {
    if (st.state === 'recording' && next !== 'recording') st.elapsedBase += now() - st.runningSince;
    if (next === 'recording' && st.state !== 'recording') st.runningSince = now();
    st.state = next;
    if (st.workoutId) append(st.workoutId, { type: 'state', t: now(), state: next, reason, seg: st.segment });
    emit('state', { ...snapshot(), reason });
  }
  function tick() {
    simClock += 1000;
    const p = route.step(1, simClock);
    delete p._trueAlt;
    delete p._trueDist;
    const act = activityProfile(st.activity);
    st.last = { t: p.t, lat: p.lat, lon: p.lon, accuracy: p.ha, altitude: p.af, speed: p.sp, bearing: p.br };
    // Simulated watch heart rate.
    const grade = prevAlt == null ? 0 : ((p.af - prevAlt) / Math.max(0.5, p.sp)) * 100;
    prevAlt = p.af;
    const bpm = heart.step(1, st.activity, st.state === 'paused' ? 0 : p.sp, grade);
    st.hr = bpm;
    if (st.state !== 'paused') append(st.workoutId, { type: 'hr', t: p.t, bpm });
    emit('hr', { bpm, t: p.t });
    if (st.state !== 'paused') {
      st.seq++;
      append(st.workoutId, { type: 'pt', s: st.seq, ...p, seg: st.segment, ...(st.state === 'autopaused' ? { p: 1 } : {}) });
      if (st.state === 'recording' && p.ha <= act.accuracyGate) {
        if (!anchor || anchor.seg !== st.segment) anchor = { ...p, seg: st.segment };
        else {
          const d = haversine(anchor.lat, anchor.lon, p.lat, p.lon);
          if (d >= Math.max(2, p.ha * 0.6) || (p.sp >= act.stationarySpeed && d >= 1)) {
            st.distance += d;
            anchor = { ...p, seg: st.segment };
          }
        }
      }
      const text = st.state === 'recording' ? coach?.onProgress(st.distance, elapsed()) : null;
      if (text) {
        webSpeak(text);
        emit('announce', { text });
      }
    }
    emit('point', snapshot());
  }
  function startTimer() {
    clearInterval(timer);
    timer = setInterval(tick, 1000 / speedup);
  }

  return {
    isNative: false,
    async checkPermissions() {
      return { location: 'granted', notifications: 'granted' };
    },
    async requestPermissions() {
      return { location: 'granted', notifications: 'granted' };
    },
    async getCapabilities() {
      return { barometer: true, compass: true, gpsEnabled: true, ignoringBatteryOptimizations: true, manufacturer: 'Browser', model: 'Simulator', sdk: 36 };
    },
    async start({ workoutId, activity, resume }) {
      if (st.state !== 'idle') throw Object.assign(new Error('A workout is already in progress'), { code: 'busy' });
      clearInterval(warmTimer);
      simClock = Date.now();
      route = new SyntheticRoute({ activity, ...START, seed: Date.now() % 1000 });
      heart = new HeartModel({ seed: Date.now() % 997 });
      prevAlt = null;
      st = { ...idleState(), workoutId, activity, startedAt: simClock };
      anchor = null;
      coach = new VoiceCoach(voiceConfig(settings(), activity));
      if (!resume) {
        localStorage.removeItem(JKEY(workoutId));
        append(workoutId, { type: 'meta', v: 1, workoutId, activity, startedAt: simClock, autoPause: false, hasBarometer: true, device: 'browser simulator' });
      } else {
        st.segment = 1;
      }
      setState('recording', resume ? 'restored' : 'start');
      startTimer();
      return { workoutId };
    },
    async pause() {
      if (st.state === 'recording' || st.state === 'autopaused') setState('paused', 'pause');
    },
    async resume() {
      if (st.state !== 'paused') return;
      st.segment++;
      setState('recording', 'resume');
    },
    async stop() {
      if (st.state === 'idle') return { workoutId: null, pointCount: 0 };
      const id = st.workoutId;
      const count = st.seq;
      setState('idle', 'stop');
      append(id, { type: 'end', t: now(), elapsedMs: st.elapsedBase, distance: st.distance });
      clearInterval(timer);
      st = idleState();
      return { workoutId: id, pointCount: count, saved: false };
    },
    async getStatus() {
      return snapshot();
    },
    async startWarmup() {
      clearInterval(warmTimer);
      let acc = 40;
      let k = 0;
      warmTimer = setInterval(() => {
        acc = Math.max(4, acc * 0.7);
        k++;
        // A slowly wandering fix with barometric altitude, like a phone held still outdoors.
        const alt = START.alt + Math.sin(k / 9) * 0.4;
        emit('point', {
          state: 'idle',
          last: {
            t: Date.now(),
            lat: START.lat + Math.sin(k / 7) * 0.00002,
            lon: START.lon + Math.cos(k / 11) * 0.00002,
            accuracy: acc,
            altitude: alt,
            altitudeAccuracy: 3 + acc / 10,
            altitudeSource: 'barometer',
            pressure: Math.round(1013.25 * Math.pow(1 - alt / 44330, 5.255) * 100) / 100,
            speed: 0.2 + Math.abs(Math.sin(k / 5)) * 0.3,
            bearing: (k * 13) % 360,
          },
        });
        emit('gnss', { satsUsed: Math.round(30 - acc / 2), satsVisible: 34, cn0: 32 });
      }, 1000);
    },
    async stopWarmup() {
      clearInterval(warmTimer);
    },
    async startHeading() {
      clearInterval(headingTimer);
      setTimeout(() => emit('heading', { heading: 40, accuracy: 3 }), 0);
      let h = 40;
      headingTimer = setInterval(() => {
        h = (h + (Math.random() - 0.5) * 6 + 360) % 360;
        emit('heading', { heading: h, accuracy: 3 });
      }, 400);
    },
    async stopHeading() {
      clearInterval(headingTimer);
    },
    async listJournals() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('sim-journal:')) continue;
        const text = localStorage.getItem(key) ?? '';
        const id = key.slice('sim-journal:'.length);
        const lines = text.trim().split('\n');
        let meta = null;
        try {
          meta = JSON.parse(lines[0]);
        } catch {
          /* empty */
        }
        out.push({
          workoutId: id,
          ended: lines[lines.length - 1]?.includes('"type":"end"') ?? false,
          active: st.workoutId === id && st.state !== 'idle',
          sizeBytes: text.length,
          modifiedAt: Date.now(),
          meta,
        });
      }
      return out;
    },
    async readJournal(workoutId) {
      const text = localStorage.getItem(JKEY(workoutId));
      if (text == null) throw new Error('Journal not found');
      return text;
    },
    async deleteJournal(workoutId) {
      localStorage.removeItem(JKEY(workoutId));
      return { deleted: true };
    },
    async setKeepScreenOn() {},
    async speak(text) {
      webSpeak(text);
    },
    async pinWidget() {
      return { supported: false };
    },
    async getWatchStatus() {
      return { supported: true, connected: true, watches: [{ name: 'Simulated watch', nearby: true }], backgroundLocation: true };
    },
    async requestBackgroundLocation() {
      return { granted: true };
    },
    async requestIgnoreBatteryOptimizations() {},
    async openAppSettings() {},
    async openLocationSettings() {},
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(cb);
      return () => listeners.get(event)?.delete(cb);
    },
  };
}

function webSpeak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-GB';
    speechSynthesis.speak(u);
  } catch {
    /* no Web Speech */
  }
}

export const tracker = Capacitor.isNativePlatform() ? nativeTracker() : simTracker();

// User settings persisted with @capacitor/preferences (localStorage on web).

import { Preferences } from '@capacitor/preferences';

const KEY = 'settings.v1';

export const DEFAULT_SETTINGS = {
  units: 'metric',
  theme: 'system',
  keepScreenOn: true,
  autoPause: { walk: false, run: false, cycle: true, ski: false },
  liveSpeedMode: { walk: 'pace', run: 'pace', cycle: 'speed', ski: 'speed' },
  mapStyle: 'streets',
  exaggeration: 'auto',
  satellite3d: true,
  smooth3d: true,
  coordFormat: 'decimal',
  /** Spoken announcements during a workout, each kind on or off per activity. */
  voice: {
    splits: { walk: true, run: true, cycle: false, ski: false },
    time: { walk: false, run: false, cycle: false, ski: false },
    goal: { walk: false, run: false, cycle: false, ski: false },
    intervalMin: 10,
    /** Goal distance per activity in metres, set on the start screen. */
    goalM: { walk: 5000, run: 10000, cycle: 40000, ski: 20000 },
    /** Lower other audio while speaking (true) or pause it (false). */
    duck: true,
  },
  /** For calories, heart-rate zones and cardio load. Weight in kg. */
  profile: { birthYear: null, sex: null, weightKg: null, restingHr: null, maxHr: null },
};

let current = structuredClone(DEFAULT_SETTINGS);
const listeners = new Set();

export async function loadSettings() {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) {
      const saved = JSON.parse(value);
      current = {
        ...DEFAULT_SETTINGS,
        ...saved,
        autoPause: { ...DEFAULT_SETTINGS.autoPause, ...saved.autoPause },
        liveSpeedMode: { ...DEFAULT_SETTINGS.liveSpeedMode, ...saved.liveSpeedMode },
        profile: { ...DEFAULT_SETTINGS.profile, ...saved.profile },
        voice: mergeVoice(saved.voice),
      };
    }
  } catch {
    current = structuredClone(DEFAULT_SETTINGS);
  }
  applyTheme();
  return current;
}

function mergeVoice(saved = {}) {
  const d = DEFAULT_SETTINGS.voice;
  return {
    ...d,
    ...saved,
    splits: { ...d.splits, ...saved.splits },
    time: { ...d.time, ...saved.time },
    goal: { ...d.goal, ...saved.goal },
    goalM: { ...d.goalM, ...saved.goalM },
  };
}

export function settings() {
  return current;
}

export async function updateSettings(patch) {
  current = { ...current, ...patch };
  applyTheme();
  await Preferences.set({ key: KEY, value: JSON.stringify(current) });
  listeners.forEach((fn) => fn(current));
  return current;
}

export function onSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyTheme() {
  const root = document.documentElement;
  if (current.theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = current.theme;
}

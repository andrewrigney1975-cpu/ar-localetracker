// User settings persisted with @capacitor/preferences (localStorage on web).

import { Preferences } from '@capacitor/preferences';
import { HII_DEFAULTS } from './hii/plan.js';

const KEY = 'settings.v1';

export const DEFAULT_SETTINGS = {
  units: 'metric',
  theme: 'system',
  keepScreenOn: true,
  autoPause: { walk: false, run: false, hii: false, cycle: true, ski: false },
  liveSpeedMode: { walk: 'pace', run: 'pace', hii: 'pace', cycle: 'speed', ski: 'speed' },
  mapStyle: 'streets',
  exaggeration: 'auto',
  map3d: true,
  smooth3d: true,
  coordFormat: 'decimal',
  /** Look up the weather at each workout's start from Open-Meteo (services/weather.js). */
  weather: true,
  /**
   * Learned routines: user names by routine id, workouts left out of learning, routines
   * the user marked in History or a workout's Distance tile ({id, name, activity,
   * workoutIds}), and workouts the user took out of their routine.
   */
  routines: { names: {}, excluded: [], user: [], detached: [] },
  /** Targets per activity ('all' or one) and period: {"run.week": {distance, time, cardioLoad, calories}} (src/insights/goals.js). */
  goals: {},
  /** Spoken announcements during a workout, each kind on or off per activity. */
  voice: {
    splits: { walk: true, run: true, hii: false, cycle: false, ski: false },
    time: { walk: false, run: false, hii: false, cycle: false, ski: false },
    /** 'off' | 'set' (distance from the start screen) | 'auto' (predicted from routines). */
    goalMode: { walk: 'auto', run: 'auto', hii: 'auto', cycle: 'auto', ski: 'off' },
    /** Say the goal when it is chosen. */
    confirmGoal: true,
    /** On a recognised routine, say the metres to go: 1000, 500, 200 and 100. */
    countdown: false,
    /** Vibrate a paired watch with each announcement (a pattern per kind). */
    watchBuzz: true,
    intervalMin: 10,
    /** Goal distance per activity in metres, set on the start screen. */
    goalM: { walk: 5000, run: 10000, hii: 5000, cycle: 40000, ski: 20000 },
    /** Lower other audio while speaking (true) or pause it (false). */
    duck: true,
    /** Turn the media volume up to full while speaking, then back. */
    loud: false,
    /**
     * Per-routine settings that replace the activity's once the routine is recognised:
     * {[routineId]: {splits, time, goal, intervalMin}}.
     */
    routines: {},
  },
  /**
   * High-intensity intervals (hii/plan.js): share of the time per mode (%), shortest and
   * longest bout per mode (s), the length when no routine gives one (min), and routines
   * that run as intervals ({[routineId]: true}) until turned off.
   */
  hii: { ...structuredClone(HII_DEFAULTS), routines: {} },
  /** For calories, heart-rate zones and cardio load (weight in kg); name labels shared courses. */
  profile: { name: null, birthYear: null, sex: null, heightCm: null, weightKg: null, restingHr: null, maxHr: null },
};

let current = structuredClone(DEFAULT_SETTINGS);
const listeners = new Set();

export async function loadSettings() {
  try {
    const { value } = await Preferences.get({ key: KEY });
    if (value) {
      // satellite3d went with the Esri imagery, terrain3d with shaded relief (map3d replaced both).
      const { satellite3d: _satellite, terrain3d: _terrain, ...saved } = JSON.parse(value);
      current = {
        ...DEFAULT_SETTINGS,
        ...saved,
        autoPause: { ...DEFAULT_SETTINGS.autoPause, ...saved.autoPause },
        liveSpeedMode: { ...DEFAULT_SETTINGS.liveSpeedMode, ...saved.liveSpeedMode },
        profile: { ...DEFAULT_SETTINGS.profile, ...saved.profile },
        voice: mergeVoice(saved.voice),
        routines: { ...DEFAULT_SETTINGS.routines, ...saved.routines },
        hii: mergeHii(saved.hii),
      };
    }
  } catch {
    current = structuredClone(DEFAULT_SETTINGS);
  }
  applyTheme();
  return current;
}

function mergeHii(saved = {}) {
  const d = DEFAULT_SETTINGS.hii;
  return { ...d, ...saved, shares: { ...d.shares, ...saved.shares }, bouts: { ...d.bouts, ...saved.bouts }, routines: { ...saved.routines } };
}

function mergeVoice(saved = {}) {
  const d = DEFAULT_SETTINGS.voice;
  const { goal: oldGoal, ...rest } = saved;
  // Before goal modes, `goal` was on/off per activity: on becomes 'set', off becomes the default.
  const migrated = oldGoal ? Object.fromEntries(Object.entries(oldGoal).filter(([, on]) => on).map(([a]) => [a, 'set'])) : {};
  return {
    ...d,
    ...rest,
    splits: { ...d.splits, ...saved.splits },
    time: { ...d.time, ...saved.time },
    goalMode: { ...d.goalMode, ...migrated, ...saved.goalMode },
    goalM: { ...d.goalM, ...saved.goalM },
    routines: { ...saved.routines },
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

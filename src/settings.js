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
      };
    }
  } catch {
    current = structuredClone(DEFAULT_SETTINGS);
  }
  applyTheme();
  return current;
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

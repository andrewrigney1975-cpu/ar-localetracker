// Per-activity tuning. Keep thresholds in sync with ActivityProfile.java.

const icon = (path) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const ACTIVITIES = {
  walk: {
    id: 'walk',
    label: 'Walk',
    verb: 'Walking',
    accuracyGate: 30,
    maxSpeed: 4,
    stationarySpeed: 0.4,
    processNoise: 0.5,
    liveSpeedMode: 'pace',
    tcxSport: 'Other',
    icon: icon('<circle cx="13" cy="4" r="2"/><path d="M10 21l2-6 3 3v3"/><path d="M7 12l3-4 4 1 2 4"/><path d="M12 15l-1-6"/>'),
  },
  run: {
    id: 'run',
    label: 'Run',
    verb: 'Running',
    accuracyGate: 25,
    maxSpeed: 9,
    stationarySpeed: 0.8,
    processNoise: 1.5,
    liveSpeedMode: 'pace',
    tcxSport: 'Running',
    icon: icon('<circle cx="15" cy="4" r="2"/><path d="M5 20l4-4 2 1"/><path d="M8 11l3-3 4 1 2 4 3 1"/><path d="M11 8l-1 6 4 2-1 5"/>'),
  },
  cycle: {
    id: 'cycle',
    label: 'Cycle',
    verb: 'Cycling',
    accuracyGate: 30,
    maxSpeed: 30,
    stationarySpeed: 1.0,
    processNoise: 2,
    liveSpeedMode: 'speed',
    tcxSport: 'Biking',
    icon: icon('<circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-7h5l3 7"/><path d="M10 9l2 7h-6"/><path d="M14 6h3"/>'),
  },
  ski: {
    id: 'ski',
    label: 'Ski',
    verb: 'Skiing',
    accuracyGate: 30,
    maxSpeed: 45,
    stationarySpeed: 1.0,
    processNoise: 4,
    liveSpeedMode: 'speed',
    tcxSport: 'Other',
    icon: icon('<circle cx="16" cy="4" r="2"/><path d="M3 15l18 6"/><path d="M8 13l3-5 4 2 3 3"/><path d="M11 8l1 6-3 2"/>'),
  },
};

export const ACTIVITY_IDS = Object.keys(ACTIVITIES);

export function activity(id) {
  return ACTIVITIES[id] ?? ACTIVITIES.run;
}

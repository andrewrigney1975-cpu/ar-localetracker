import { beforeEach, describe, expect, it, vi } from 'vitest';
import { conditionOf, formatTemperature, parseWeather, weatherLine, weatherText, weatherUrls, WINDY_MS } from '../src/weather/weather.js';

const store = new Map();
vi.mock('../src/db/workouts.js', () => ({
  listWorkouts: async () => [...store.values()],
  updateWorkout: async (id, patch) => {
    const next = { ...store.get(id), ...patch };
    store.set(id, next);
    return next;
  },
}));
vi.mock('../src/settings.js', () => ({ settings: () => ({ weather: true }) }));

// Open-Meteo's hourly shape (GMT), the hours around a 04:20 start.
const hourly = {
  time: ['2026-10-22T03:00', '2026-10-22T04:00', '2026-10-22T05:00'],
  temperature_2m: [24, 25, 28],
  apparent_temperature: [23, 24, 26],
  wind_speed_10m: [2, 4, 6],
  wind_direction_10m: [300, 350, 10],
  wind_gusts_10m: [5, 8, 12],
  weather_code: [1, 2, 61],
  is_day: [1, 1, 1],
};
const start = Date.UTC(2026, 9, 22, 4, 20);

describe('weather at the start', () => {
  it('interpolates between the hours either side, wind as a vector', () => {
    const w = parseWeather({ hourly }, start);
    expect(w.tempC).toBe(26); // 25 + 3 × 1/3
    expect(w.feelsC).toBe(24.7);
    expect(w.windMs).toBe(4.7);
    expect(w.gustMs).toBe(9.3);
    // 350° and 10° average through north, not south.
    expect(w.windDeg).toBeGreaterThan(350);
    expect(w.code).toBe(2); // the nearer hour (04:00)
    expect(w.condition).toBe('Partly cloudy');
    expect(w.isDay).toBe(true);
  });

  it('takes the weather code from the nearer hour', () => {
    expect(parseWeather({ hourly }, Date.UTC(2026, 9, 22, 4, 40)).code).toBe(61);
  });

  it('returns null without values for that time', () => {
    expect(parseWeather({ hourly }, Date.UTC(2026, 9, 22, 2, 0))).toBeNull();
    expect(parseWeather({ hourly: { ...hourly, temperature_2m: [null, null, null] } }, start)).toBeNull();
    expect(parseWeather({}, start)).toBeNull();
  });

  it('calls strong wind or gusts windy, joining any precipitation', () => {
    expect(conditionOf(0, 3)).toEqual({ condition: 'Clear', windy: false });
    expect(conditionOf(0, WINDY_MS)).toEqual({ condition: 'Windy', windy: true });
    expect(conditionOf(3, 4, 15)).toEqual({ condition: 'Windy', windy: true });
    expect(conditionOf(63, 9)).toEqual({ condition: 'Rain, windy', windy: true });
    expect(conditionOf(45, 1).condition).toBe('Fog');
    expect(conditionOf(999, 1).condition).toBe('Unknown');
  });

  it('asks the forecast API for recent workouts and the archives for older ones, with rounded coordinates', () => {
    const recent = weatherUrls(-35.162857, 147.3573527, start, start + 86400000);
    expect(recent.map((u) => u.source)).toEqual(['forecast', 'historical', 'archive']);
    expect(recent[0].url).toContain('latitude=-35.16&longitude=147.36');
    expect(recent[0].url).toContain('start_date=2026-10-22&end_date=2026-10-22');
    expect(weatherUrls(-35.16, 147.36, start, start + 200 * 86400000).map((u) => u.source)).toEqual(['historical', 'archive']);
    // 23:30 needs the next day's first hour too.
    expect(weatherUrls(0, 0, Date.UTC(2026, 9, 22, 23, 30), start)[0].url).toContain('start_date=2026-10-22&end_date=2026-10-23');
  });

  it('formats for display and sharing in either units', () => {
    const w = { tempC: 14.4, feelsC: 12.2, windMs: 5, windDeg: 225, gustMs: 9, condition: 'Partly cloudy' };
    expect(weatherText(w, 'metric')).toEqual({ condition: 'Partly cloudy', temp: '14 °C', feels: '12 °C', wind: 'SW 18 km/h', gusts: '32 km/h' });
    expect(weatherLine(w, 'metric')).toBe('Partly cloudy, 14 °C (feels 12 °C), wind SW 18 km/h');
    expect(weatherLine({ ...w, windMs: 0.2, gustMs: 0.5 }, 'imperial')).toBe('Partly cloudy, 58 °F (feels 54 °F), wind calm');
    expect(formatTemperature(-0.4, 'metric')).toBe('0 °C');
    expect(weatherText({ unavailable: true }, 'metric')).toBeNull();
    expect(weatherLine(undefined, 'metric')).toBe('');
  });
});

describe('weather lookup and back-fill', () => {
  const walk = (id, startedAt) => ({ id, startedAt, preview: [[147.3573527, -35.162857]] });
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  let svc;
  beforeEach(async () => {
    store.clear();
    vi.resetModules();
    svc = await import('../src/services/weather.js');
  });

  it('stores the weather with its source and the rounded position', async () => {
    store.set('a', walk('a', start));
    const fetchImpl = vi.fn(async () => ok({ hourly }));
    const w = await svc.lookupWeather(store.get('a'), { fetchImpl });
    expect(w.weather).toMatchObject({ tempC: 26, condition: 'Partly cloudy', source: 'forecast', lat: -35.16, lon: 147.36 });
    expect(svc.needsWeather(w)).toBe(false);
  });

  it('tries the next service when one has no data, and marks a time none of them have', async () => {
    store.set('a', walk('a', Date.UTC(2020, 0, 1, 4)));
    const fetchImpl = vi.fn(async (url) => (url.includes('archive') ? ok({ hourly: { time: [] } }) : { ok: false, status: 400 }));
    const w = await svc.lookupWeather(store.get('a'), { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(w.weather.unavailable).toBe(true);
  });

  it('leaves the workout for later when offline', async () => {
    store.set('a', walk('a', start));
    const offline = async () => {
      throw new TypeError('Failed to fetch');
    };
    expect(await svc.lookupWeather(store.get('a'), { fetchImpl: offline })).toBeNull();
    expect(store.get('a').weather).toBeUndefined();
  });

  it('back-fills every workout without weather and tells the lists', async () => {
    store.set('a', walk('a', start));
    store.set('b', walk('b', start - 86400000));
    store.set('c', { ...walk('c', start), weather: { tempC: 1 } });
    store.set('d', { id: 'd', startedAt: start }); // no route
    const events = [];
    vi.stubGlobal('fetch', vi.fn(async () => ok({ hourly })));
    vi.stubGlobal('window', { dispatchEvent: (e) => events.push(e.type) });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(type) {
          this.type = type;
        }
      }
    );
    try {
      // 'b' is a day before the hours in the response, so every service "has no data" for it.
      expect(await svc.fillWeather()).toBe(2);
      expect(store.get('a').weather.tempC).toBe(26);
      expect(store.get('b').weather.unavailable).toBe(true);
      expect(store.get('c').weather).toEqual({ tempC: 1 });
      expect(store.get('d').weather).toBeUndefined();
      expect(events).toEqual(['workouts-changed']);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

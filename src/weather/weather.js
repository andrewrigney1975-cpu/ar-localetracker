// Weather at a workout's start, from Open-Meteo's hourly model data (free, no API key).
// Pure: builds the request URLs and turns a response into the record's `weather` field.
// The fetching and storing is in services/weather.js.

import { headingCardinal, speedUnit, speedValue } from '../units.js';

const VARS = 'temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day';
const DAY_MS = 86400000;
const HOUR_MS = 3600000;

/** The forecast API keeps about 3 months of past hours; older workouts use the archives. */
const RECENT_DAYS = 80;

/** Wind that makes the conditions "Windy": a fresh breeze (Beaufort 5) or strong gusts. */
export const WINDY_MS = 30 / 3.6;
export const WINDY_GUST_MS = 50 / 3.6;

/**
 * Coordinates sent to Open-Meteo, rounded to 2 decimals (about 1 km): the weather model's
 * grid is coarser than that, and it keeps the exact start of a route on the phone.
 */
export const roundCoord = (v) => Math.round(v * 100) / 100;

const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Request URLs to try in order for the hours around `startedAt`: the forecast API for recent
 * workouts, then the historical forecast archive (2022 on), then the ERA5 reanalysis.
 * @returns {{source: string, url: string}[]}
 */
export function weatherUrls(lat, lon, startedAt, now = Date.now()) {
  const hour = Math.floor(startedAt / HOUR_MS) * HOUR_MS;
  const q = `latitude=${roundCoord(lat)}&longitude=${roundCoord(lon)}&hourly=${VARS}&wind_speed_unit=ms&timezone=GMT&start_date=${isoDay(hour)}&end_date=${isoDay(hour + HOUR_MS)}`;
  const urls = [];
  if (now - startedAt < RECENT_DAYS * DAY_MS) urls.push({ source: 'forecast', url: `https://api.open-meteo.com/v1/forecast?${q}` });
  urls.push({ source: 'historical', url: `https://historical-forecast-api.open-meteo.com/v1/forecast?${q}` });
  urls.push({ source: 'archive', url: `https://archive-api.open-meteo.com/v1/archive?${q}` });
  return urls;
}

const lerp = (a, b, f) => a + (b - a) * f;

/**
 * The weather at `startedAt` from an Open-Meteo hourly response: temperatures and wind
 * interpolated between the hours either side (wind as a vector, so 350° and 10° average to
 * north), the weather code and day/night from the nearer hour.
 * @returns {object|null} null when the response has no values for that time
 */
export function parseWeather(json, startedAt) {
  const h = json?.hourly;
  const times = h?.time?.map((t) => Date.parse(`${t}:00Z`));
  if (!times?.length) return null;
  let i = times.findLastIndex((t) => t <= startedAt);
  if (i < 0) return null;
  const j = Math.min(i + 1, times.length - 1);
  const f = j === i ? 0 : (startedAt - times[i]) / (times[j] - times[i]);
  const at = (key, k) => h[key]?.[k];
  const both = (key) => Number.isFinite(at(key, i)) && Number.isFinite(at(key, j));
  if (!both('temperature_2m') || !both('wind_speed_10m')) return null;
  const vec = (k) => {
    const rad = ((at('wind_direction_10m', k) ?? 0) * Math.PI) / 180;
    return [at('wind_speed_10m', k) * Math.sin(rad), at('wind_speed_10m', k) * Math.cos(rad)];
  };
  const [u0, v0] = vec(i);
  const [u1, v1] = vec(j);
  const u = lerp(u0, u1, f);
  const v = lerp(v0, v1, f);
  const near = f < 0.5 ? i : j;
  const round1 = (x) => Math.round(x * 10) / 10;
  const windMs = round1(lerp(at('wind_speed_10m', i), at('wind_speed_10m', j), f));
  const gustMs = both('wind_gusts_10m') ? round1(lerp(at('wind_gusts_10m', i), at('wind_gusts_10m', j), f)) : null;
  const code = at('weather_code', near) ?? null;
  return {
    tempC: round1(lerp(at('temperature_2m', i), at('temperature_2m', j), f)),
    feelsC: both('apparent_temperature') ? round1(lerp(at('apparent_temperature', i), at('apparent_temperature', j), f)) : null,
    windMs,
    windDeg: windMs > 0 ? Math.round(((Math.atan2(u, v) * 180) / Math.PI + 360) % 360) : null,
    gustMs,
    code,
    isDay: at('is_day', near) == null ? null : at('is_day', near) === 1,
    ...conditionOf(code, windMs, gustMs),
  };
}

/** WMO weather interpretation codes, as Open-Meteo reports them. */
const CODES = {
  0: 'Clear',
  1: 'Mostly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light showers',
  81: 'Showers',
  82: 'Heavy showers',
  85: 'Snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
};

/**
 * The prevailing condition: the sky or precipitation from the weather code, and "Windy"
 * when the wind is strong. Windy replaces a dry sky ("Windy") and joins anything else
 * ("Rain, windy").
 * @returns {{condition: string, windy: boolean}}
 */
export function conditionOf(code, windMs, gustMs = null) {
  const windy = windMs >= WINDY_MS || (gustMs ?? 0) >= WINDY_GUST_MS;
  const sky = CODES[code] ?? null;
  if (!windy) return { condition: sky ?? 'Unknown', windy };
  return { condition: sky && code > 3 ? `${sky}, windy` : 'Windy', windy };
}

/** °C or °F, whole degrees. */
export function formatTemperature(c, units) {
  if (!Number.isFinite(c)) return '–';
  return units === 'imperial' ? `${Math.round((c * 9) / 5 + 32)} °F` : `${Math.round(c)} °C`;
}

/**
 * Display strings for a stored `weather`: temperature, feels like, wind ("SW 18 km/h"),
 * gusts and the condition. Null when there's no weather to show.
 */
export function weatherText(weather, units) {
  if (!weather || weather.unavailable) return null;
  const speed = (ms) => `${Math.round(speedValue(ms, units))} ${speedUnit(units)}`;
  const calm = !(weather.windMs >= 0.5);
  return {
    condition: weather.condition,
    temp: formatTemperature(weather.tempC, units),
    feels: weather.feelsC == null ? null : formatTemperature(weather.feelsC, units),
    wind: calm ? 'Calm' : `${headingCardinal(weather.windDeg)} ${speed(weather.windMs)}`,
    gusts: weather.gustMs > weather.windMs + 1 ? speed(weather.gustMs) : null,
  };
}

/** One line for shared text: "Partly cloudy, 14 °C (feels 12 °C), wind SW 18 km/h". */
export function weatherLine(weather, units) {
  const t = weatherText(weather, units);
  if (!t) return '';
  const feels = t.feels && t.feels !== t.temp ? ` (feels ${t.feels})` : '';
  return `${t.condition}, ${t.temp}${feels}, wind ${t.wind === 'Calm' ? 'calm' : t.wind}`;
}

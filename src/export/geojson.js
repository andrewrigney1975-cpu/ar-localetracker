import { segmentRanges } from './xml.js';

const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

/** GeoJSON FeatureCollection: one (Multi)LineString with per-coordinate times. */
export function toGeoJSON(workout, track) {
  const parts = [];
  const times = [];
  for (const [from, to] of segmentRanges(track)) {
    const coords = [];
    const t = [];
    for (let i = from; i < to; i++) {
      const c = [round(track.lon[i], 7), round(track.lat[i], 7)];
      if (Number.isFinite(track.alt[i])) c.push(round(track.alt[i], 1));
      coords.push(c);
      t.push(new Date(track.t[i]).toISOString());
    }
    parts.push(coords);
    times.push(t);
  }
  const single = parts.length === 1;
  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: single ? { type: 'LineString', coordinates: parts[0] } : { type: 'MultiLineString', coordinates: parts },
        properties: {
          name: workout.name,
          activity: workout.activity,
          startedAt: new Date(workout.startedAt).toISOString(),
          distance_m: workout.summary?.distance ?? null,
          duration_s: workout.summary?.duration ?? null,
          coordTimes: single ? times[0] : times,
        },
      },
    ],
  };
  return JSON.stringify(fc) + '\n';
}

import { toCSV } from './csv.js';
import { toGeoJSON } from './geojson.js';
import { toGPX } from './gpx.js';
import { toKML } from './kml.js';
import { toTCX } from './tcx.js';

export const EXPORT_FORMATS = [
  { id: 'gpx', label: 'GPX', description: 'Universal GPS track: Strava, Garmin, Komoot', ext: 'gpx', mime: 'application/gpx+xml', fn: toGPX },
  { id: 'tcx', label: 'TCX', description: 'Garmin Training Center, with 1 km laps', ext: 'tcx', mime: 'application/vnd.garmin.tcx+xml', fn: toTCX },
  { id: 'kml', label: 'KML', description: 'Google Earth, shown in 3D', ext: 'kml', mime: 'application/vnd.google-earth.kml+xml', fn: toKML },
  { id: 'geojson', label: 'GeoJSON', description: 'GIS tools and web maps', ext: 'geojson', mime: 'application/geo+json', fn: toGeoJSON },
  { id: 'csv', label: 'CSV', description: 'Spreadsheet of every recorded point', ext: 'csv', mime: 'text/csv', fn: toCSV },
];

export function exportFileName(workout, ext) {
  const d = new Date(workout.startedAt);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `locale_${workout.activity}_${stamp}.${ext}`;
}

export function renderExport(formatId, workout, track) {
  const fmt = EXPORT_FORMATS.find((f) => f.id === formatId);
  if (!fmt) throw new Error(`Unknown export format ${formatId}`);
  return { ...fmt, filename: exportFileName(workout, fmt.ext), content: fmt.fn(workout, track) };
}

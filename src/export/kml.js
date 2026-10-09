import { distanceMarkers } from '../stats/summary.js';
import { esc, fixed, segmentRanges } from './xml.js';

/** KML 2.2 with absolute altitude (renders in 3D in Google Earth) and 1 km placemarks. */
export function toKML(workout, track) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<kml xmlns="http://www.opengis.net/kml/2.2">');
  lines.push('  <Document>');
  lines.push(`    <name>${esc(workout.name)}</name>`);
  lines.push('    <Style id="track"><LineStyle><color>ff2f8cff</color><width>4</width></LineStyle></Style>');
  lines.push('    <Placemark>');
  lines.push(`      <name>${esc(workout.name)}</name>`);
  lines.push('      <styleUrl>#track</styleUrl>');
  lines.push('      <MultiGeometry>');
  for (const [from, to] of segmentRanges(track)) {
    const coords = [];
    for (let i = from; i < to; i++) {
      coords.push(`${track.lon[i].toFixed(7)},${track.lat[i].toFixed(7)},${fixed(track.alt[i], 1) ?? 0}`);
    }
    lines.push('        <LineString><tessellate>1</tessellate><altitudeMode>absolute</altitudeMode><coordinates>');
    lines.push('          ' + coords.join(' '));
    lines.push('        </coordinates></LineString>');
  }
  lines.push('      </MultiGeometry>');
  lines.push('    </Placemark>');
  lines.push('    <Folder><name>Kilometres</name>');
  for (const m of distanceMarkers(track, 1000)) {
    lines.push(
      `      <Placemark><name>${m.k} km</name><Point><altitudeMode>absolute</altitudeMode>` +
        `<coordinates>${m.lon.toFixed(7)},${m.lat.toFixed(7)},${fixed(m.alt, 1) ?? 0}</coordinates></Point></Placemark>`
    );
  }
  lines.push('    </Folder>');
  lines.push('  </Document>');
  lines.push('</kml>');
  return lines.join('\n') + '\n';
}

import { esc, fixed, iso, segmentRanges } from './xml.js';

/** GPX 1.1 with a Garmin TrackPointExtension (v2) for speed and course. */
export function toGPX(workout, track) {
  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push(
    '<gpx version="1.1" creator="Locale Exercise Tracker" xmlns="http://www.topografix.com/GPX/1/1" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
      'xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v2" ' +
      'xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd ' +
      'http://www.garmin.com/xmlschemas/TrackPointExtension/v2 http://www.garmin.com/xmlschemas/TrackPointExtensionv2.xsd">'
  );
  lines.push('  <metadata>');
  lines.push(`    <name>${esc(workout.name)}</name>`);
  lines.push(`    <time>${iso(workout.startedAt)}</time>`);
  lines.push('  </metadata>');
  lines.push('  <trk>');
  lines.push(`    <name>${esc(workout.name)}</name>`);
  if (workout.notes) lines.push(`    <desc>${esc(workout.notes)}</desc>`);
  lines.push(`    <type>${esc(workout.activity)}</type>`);
  for (const [from, to] of segmentRanges(track)) {
    lines.push('    <trkseg>');
    for (let i = from; i < to; i++) {
      lines.push(`      <trkpt lat="${track.lat[i].toFixed(7)}" lon="${track.lon[i].toFixed(7)}">`);
      const ele = fixed(track.alt[i], 1);
      if (ele != null) lines.push(`        <ele>${ele}</ele>`);
      lines.push(`        <time>${iso(track.t[i])}</time>`);
      const speed = fixed(track.speed[i], 2);
      const course = fixed(track.course[i], 1);
      const hr = track.hr && Number.isFinite(track.hr[i]) ? Math.round(track.hr[i]) : null;
      lines.push(
        '        <extensions><gpxtpx:TrackPointExtension>' +
          (hr != null ? `<gpxtpx:hr>${hr}</gpxtpx:hr>` : '') +
          (speed != null ? `<gpxtpx:speed>${speed}</gpxtpx:speed>` : '') +
          (course != null ? `<gpxtpx:course>${course}</gpxtpx:course>` : '') +
          '</gpxtpx:TrackPointExtension></extensions>'
      );
      lines.push('      </trkpt>');
    }
    lines.push('    </trkseg>');
  }
  lines.push('  </trk>');
  lines.push('</gpx>');
  return lines.join('\n') + '\n';
}

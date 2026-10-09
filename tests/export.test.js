import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { renderExport, EXPORT_FORMATS } from '../src/export/index.js';
import { processJournal } from '../src/geo/process.js';
import { computeSummary } from '../src/stats/summary.js';
import { parseJournal } from '../src/tracker/journal.js';
import { generateJournal } from '../src/tracker/synthetic.js';

const { text } = generateJournal({ activity: 'run', seconds: 900, pauses: [[400, 60]] });
const { track, info } = processJournal(parseJournal(text));
const workout = {
  id: 'w1',
  name: 'Morning <Run> & "hills"',
  notes: 'Felt good',
  activity: 'run',
  startedAt: info.startedAt,
  summary: computeSummary(track, info),
};
const parser = new XMLParser({ ignoreAttributes: false });

describe('exporters', () => {
  it('GPX is well-formed with one trkseg per segment', () => {
    const out = renderExport('gpx', workout, track);
    expect(XMLValidator.validate(out.content)).toBe(true);
    const doc = parser.parse(out.content);
    const segs = doc.gpx.trk.trkseg;
    expect(segs.length).toBe(2);
    const total = segs.reduce((a, s) => a + s.trkpt.length, 0);
    expect(total).toBe(track.n);
    expect(doc.gpx.metadata.name).toContain('&');
    expect(out.filename).toMatch(/^locale_run_\d{4}-\d{2}-\d{2}_\d{4}\.gpx$/);
  });

  it('TCX laps contain every trackpoint exactly once', () => {
    const out = renderExport('tcx', workout, track);
    expect(XMLValidator.validate(out.content)).toBe(true);
    const doc = parser.parse(out.content);
    const laps = [].concat(doc.TrainingCenterDatabase.Activities.Activity.Lap);
    const count = laps.reduce((a, l) => a + (l.Track ? [].concat(l.Track.Trackpoint).length : 0), 0);
    expect(count).toBe(track.n);
    expect(doc.TrainingCenterDatabase.Activities.Activity['@_Sport']).toBe('Running');
  });

  it('KML is well-formed', () => {
    const out = renderExport('kml', workout, track);
    expect(XMLValidator.validate(out.content)).toBe(true);
  });

  it('GeoJSON is a MultiLineString when paused', () => {
    const fc = JSON.parse(renderExport('geojson', workout, track).content);
    expect(fc.features[0].geometry.type).toBe('MultiLineString');
    expect(fc.features[0].properties.coordTimes.length).toBe(2);
  });

  it('CSV has a header and one row per point', () => {
    const rows = renderExport('csv', workout, track).content.trim().split('\n');
    expect(rows.length).toBe(track.n + 1);
    expect(rows[0].split(',').length).toBe(rows[1].split(',').length);
  });

  it('every format renders', () => {
    for (const f of EXPORT_FORMATS) expect(renderExport(f.id, workout, track).content.length).toBeGreaterThan(100);
  });
});

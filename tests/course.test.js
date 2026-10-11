import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import { CourseError, courseFilename, courseId, initialsOf, parseCourse, toCourseGPX } from '../src/course/courseFile.js';
import { toGPX } from '../src/export/gpx.js';
import { toGeoJSON } from '../src/export/geojson.js';
import { buildWorkout } from '../src/services/buildWorkout.js';
import { generateJournal } from '../src/tracker/synthetic.js';

function workout(opts = {}) {
  const { text } = generateJournal({ activity: 'run', seconds: 1800, heartRate: true, ...opts });
  const built = buildWorkout(text, 'w-course');
  built.workout.name = 'Bondi loop';
  built.workout.notes = 'Private note about my knee';
  return built;
}

describe('initials and file name', () => {
  it('takes initials from a name', () => {
    expect(initialsOf('Andrew Rigney')).toBe('AR');
    expect(initialsOf('  andrew  ')).toBe('A');
    expect(initialsOf('Mary-Jane van Dyke')).toBe('MD');
    expect(initialsOf('AR')).toBe('AR');
    expect(initialsOf('A.R.')).toBe('AR');
    expect(initialsOf('')).toBe('');
  });

  it('names the file "<initials> <label>.gpx" with unsafe characters removed', () => {
    expect(courseFilename('AR', 'Bondi loop')).toBe('AR Bondi loop.gpx');
    expect(courseFilename('AR', 'Run: 5/10 "fast"?')).toBe('AR Run 5 10 fast.gpx');
    expect(courseFilename('', 'Bondi loop')).toBe('Bondi loop.gpx');
    expect(courseFilename('AR', '')).toBe('AR Course.gpx');
    expect(courseFilename('AR', 'x'.repeat(200)).length).toBeLessThanOrEqual(84);
  });
});

describe('writing a course', () => {
  const { workout: w, track } = workout({ pauses: [[600, 660]] });
  const out = toCourseGPX(w, track, { initials: 'AR' });

  it('is valid GPX 1.1 with only the route, altitude, label, initials and activity', () => {
    expect(XMLValidator.validate(out.text)).toBe(true);
    const doc = new XMLParser({ ignoreAttributes: false }).parse(out.text);
    expect(doc.gpx['@_version']).toBe('1.1');
    expect(doc.gpx.metadata.name).toBe('Bondi loop');
    expect(doc.gpx.metadata.author.name).toBe('AR');
    for (const banned of ['<time', 'speed', 'hr>', 'TrackPointExtension', 'knee', 'synthetic', 'course>', 'desc']) {
      expect(out.text).not.toContain(banned);
    }
  });

  it('keeps segments, thins points and stays close to the recorded distance and altitude', () => {
    expect(out.text.match(/<trkseg>/g).length).toBe(track.seg[track.n - 1] - track.seg[0] + 1);
    expect(out.points).toBeLessThan(track.n / 2);
    expect(Math.abs(out.distance - w.summary.distance) / w.summary.distance).toBeLessThan(0.005);
    const c = parseCourse(out.text);
    expect(Math.abs(c.summary.maxAlt - w.summary.maxAlt)).toBeLessThan(2);
    expect(Math.abs(c.summary.minAlt - w.summary.minAlt)).toBeLessThan(2);
  });

  it('caps the number of points', () => {
    const long = workout({ seconds: 4 * 3600, activity: 'cycle', seed: 3 });
    expect(toCourseGPX(long.workout, long.track).points).toBeLessThanOrEqual(5000);
  });

  it('can hide the first and last 200 m', () => {
    const hidden = toCourseGPX(w, track, { hideEnds: true });
    expect(hidden.distance).toBeGreaterThan(out.distance - 420);
    expect(hidden.distance).toBeLessThan(out.distance - 380);
    const c = parseCourse(hidden.text);
    expect(c.trimmed).toBe(true);
    // The shared start is about 200 m along the route from the real one.
    const start = parseCourse(out.text).track;
    expect(Math.hypot(c.track.lat[0] - start.lat[0], c.track.lon[0] - start.lon[0])).toBeGreaterThan(0.0005);
  });
});

describe('opening a course', () => {
  const { workout: w, track } = workout();

  it('reads back a Locale course with its name, sharer and activity', () => {
    const c = parseCourse(toCourseGPX(w, track, { initials: 'AR' }).text, 'AR Bondi loop.gpx');
    expect(c).toMatchObject({ name: 'Bondi loop', sharedBy: 'AR', activity: 'run', trimmed: false });
    expect(c.track.n).toBeGreaterThan(10);
    expect(c.summary.distance).toBeCloseTo(c.track.dist[c.track.n - 1]);
    // No timing or performance data in the track it builds.
    expect(Array.from(c.track.t).every((v) => v === 0)).toBe(true);
    expect(Array.from(c.track.speed).every((v) => v === 0)).toBe(true);
    expect(c.track.hr).toBeUndefined();
  });

  it('ignores timing, speed and heart rate in a full GPX export', () => {
    const c = parseCourse(toGPX(w, track), 'export.gpx');
    expect(c.track.n).toBe(track.n);
    expect(c.track.hr).toBeUndefined();
    expect(Array.from(c.track.t).every((v) => v === 0)).toBe(true);
    expect(c.summary.distance).toBeGreaterThan(w.summary.distance * 0.95);
  });

  it('reads GPX routes and GeoJSON lines, and names a course from the file if needed', () => {
    const rte = `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><rte><name>Ridge &amp; back</name>
      <rtept lat="-33.89" lon="151.27"><ele>10</ele></rtept><rtept lat="-33.88" lon="151.28"><ele>40</ele></rtept><rtept lat='-33.87' lon='151.28'/></rte></gpx>`;
    const r = parseCourse(rte, 'ridge.gpx');
    expect(r.name).toBe('Ridge & back');
    expect(r.track.n).toBe(3);
    const geo = parseCourse(toGeoJSON(w, track), 'Harbour walk.geojson');
    expect(geo.track.n).toBeGreaterThan(10);
    const bare = parseCourse(JSON.stringify({ type: 'LineString', coordinates: [[151.27, -33.89, 5], [151.28, -33.88, 9]] }), 'Harbour walk.geojson');
    expect(bare.name).toBe('Harbour walk');
  });

  it('keeps separate segments apart', () => {
    const two = `<gpx><trk><trkseg><trkpt lat="0" lon="0"/><trkpt lat="0" lon="0.001"/></trkseg><trkseg><trkpt lat="0.01" lon="0.01"/><trkpt lat="0.01" lon="0.011"/></trkseg></trk></gpx>`;
    const c = parseCourse(two);
    expect(c.summary.segments).toBe(2);
    // The jump between segments is not counted.
    expect(c.summary.distance).toBeLessThan(250);
  });

  it('rejects files without a usable route', () => {
    expect(() => parseCourse('<gpx></gpx>')).toThrow(CourseError);
    expect(() => parseCourse('not a course')).toThrow(CourseError);
    expect(() => parseCourse('<gpx><trk><trkseg><trkpt lat="95" lon="0"/><trkpt lat="0" lon="0"/></trkseg></trk></gpx>')).toThrow(CourseError);
  });

  it('gives the same id to the same file', () => {
    expect(courseId('abc')).toBe(courseId('abc'));
    expect(courseId('abc')).not.toBe(courseId('abd'));
  });
});

describe('course mode in the views', async () => {
  const { markerInfoHTML } = await import('../src/ui/popover.js');
  const { distanceAxis, smoothForDisplay } = await import('../src/view3d/smooth.js');
  const { sampleAtDistance } = await import('../src/geo/process.js');
  const { workout: w, track } = workout();
  const c = parseCourse(toCourseGPX(w, track, { initials: 'AR' }).text);

  it('shows distance, position and altitude in marker popovers, never time', () => {
    const html = markerInfoHTML({ title: '1 km', sample: sampleAtDistance(c.track, 1000), units: 'metric', course: true });
    expect(html).toContain('Distance');
    expect(html).toContain('Altitude');
    expect(html).not.toMatch(/Time|Clock|Heart|NaN/);
  });

  it('smooths the 3D line over distance when there is no time', () => {
    const out = smoothForDisplay(distanceAxis(c.track), { alt: c.track.alt, x: c.track.lat });
    expect(Array.from(out.alt).every(Number.isFinite)).toBe(true);
    // A real smoothing, not a pass-through: the line changes, but only a little.
    const diff = Array.from(out.x).reduce((m, v, i) => Math.max(m, Math.abs(v - c.track.lat[i])), 0);
    expect(diff).toBeGreaterThan(0);
    expect(diff).toBeLessThan(0.001);
  });
});

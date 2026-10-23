import { describe, expect, it } from 'vitest';
import { CourseError, MAX_OPEN_POINTS, parseCourse, toCourseGPX } from '../src/course/courseFile.js';
import { CourseLinkError, MAX_LINK_CHARS, VIEWER_URL, courseLinkURL, decodeCourseLink, encodeCourseLink } from '../src/course/courseLink.js';
import { buildWorkout } from '../src/services/buildWorkout.js';
import { generateJournal } from '../src/tracker/synthetic.js';

function sharedCourse(opts = {}) {
  const { text } = generateJournal({ activity: 'run', seconds: 3600, heartRate: true, ...opts });
  const built = buildWorkout(text, 'w-link');
  built.workout.name = 'Bondi & back';
  return parseCourse(toCourseGPX(built.workout, built.track, { initials: 'AR' }).text);
}

describe('course links', () => {
  it('round-trips a course: name, sharer, activity, route and altitude', async () => {
    const c = sharedCourse();
    const link = await encodeCourseLink(c);
    expect(link).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = parseCourse(await decodeCourseLink(link));
    expect(back).toMatchObject({ name: 'Bondi & back', sharedBy: 'AR', activity: 'run', trimmed: false });
    // Thinned again at 2 m, which drops little from a course that was already thinned.
    expect(back.track.n).toBeLessThanOrEqual(c.track.n);
    expect(back.track.n).toBeGreaterThan(c.track.n * 0.8);
    expect(Math.abs(back.summary.distance - c.summary.distance) / c.summary.distance).toBeLessThan(0.005);
    expect(Math.abs(back.summary.maxAlt - c.summary.maxAlt)).toBeLessThan(0.11);
    const n = back.track.n - 1;
    expect(Math.abs(back.track.lat[n] - c.track.lat[c.track.n - 1])).toBeLessThan(1e-5);
    expect(Math.abs(back.track.lon[0] - c.track.lon[0])).toBeLessThan(1e-5);
  });

  it('is short enough to send: an hour-long run is a few kilobytes', async () => {
    const c = sharedCourse();
    const link = await encodeCourseLink(c);
    expect(link.length).toBeLessThan(c.track.n * 6);
  });

  it('keeps routes from other apps without an activity, and missing altitude', async () => {
    const geo = JSON.stringify({ type: 'LineString', coordinates: [[151.2, -33.89], [151.21, -33.88], [151.22, -33.892]] });
    const c = parseCourse(geo, 'Harbour walk.geojson');
    const gpx = await decodeCourseLink(await encodeCourseLink(c));
    expect(gpx).not.toContain('<ele>');
    expect(gpx).not.toContain('activity=');
    const back = parseCourse(gpx);
    expect(back).toMatchObject({ name: 'Harbour walk', sharedBy: null, activity: null });
    expect(back.track.n).toBe(3);
  });

  it('builds the Locale Viewer address the app shares', async () => {
    const c = sharedCourse({ seconds: 600 });
    const url = await courseLinkURL(c);
    expect(url.startsWith(`${VIEWER_URL}#c=`)).toBe(true);
    expect(parseCourse(await decodeCourseLink(new URL(url).hash.slice(3))).name).toBe('Bondi & back');
  });

  it('rejects a damaged link', async () => {
    const link = await encodeCourseLink(sharedCourse({ seconds: 600 }));
    await expect(decodeCourseLink(link.slice(0, link.length >> 1))).rejects.toThrow(CourseLinkError);
    await expect(decodeCourseLink('not a link!')).rejects.toThrow(CourseLinkError);
  });

  it('refuses crafted links before they use much memory', async () => {
    // A link from any payload, as an attacker would make one.
    const linkOf = async (payload) => {
      const out = new Response(new Blob([JSON.stringify(payload)]).stream().pipeThrough(new CompressionStream('deflate-raw')));
      return Buffer.from(await out.arrayBuffer()).toString('base64url');
    };
    // Longer than the app ever makes.
    await expect(decodeCourseLink('A'.repeat(MAX_LINK_CHARS + 1))).rejects.toThrow(/longer than Locale makes/);
    // A deflate bomb: 30 MB of name in a link under the length limit.
    const bomb = await linkOf({ v: 1, n: 'x'.repeat(30 * 1024 * 1024), s: [] });
    expect(bomb.length).toBeLessThan(MAX_LINK_CHARS);
    await expect(decodeCourseLink(bomb)).rejects.toThrow(CourseLinkError);
    // Coordinates that aren't whole numbers.
    await expect(decodeCourseLink(await linkOf({ v: 1, n: 'x', s: [[1, 'a', null, 2, 3, 4]] }))).rejects.toThrow(CourseLinkError);
    await expect(decodeCourseLink(await linkOf({ v: 1, n: 'x', s: [[1, 2, 3.5, 2, 3, 4]] }))).rejects.toThrow(CourseLinkError);
    await expect(decodeCourseLink(await linkOf({ v: 1, n: 'x', s: 'abc' }))).rejects.toThrow(CourseLinkError);
    // More points than View draws, refused before they are unpacked.
    const many = await linkOf({ v: 1, n: 'x', s: [new Array((MAX_OPEN_POINTS + 1) * 3).fill(0)] });
    await expect(decodeCourseLink(many)).rejects.toThrow(CourseError);
  });
});

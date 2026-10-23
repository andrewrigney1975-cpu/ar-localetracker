// Course links: a whole course packed into a URL fragment (`#c=…`) for the web Viewer, so a
// course can be shared as a link that opens in any browser. The fragment never reaches a
// server. Like a course file, a link carries route and altitude only.
//
// Payload: JSON {v, n (name), b (shared by), a (activity), t (start and finish hidden),
// s (segments)}, deflated and base64url-encoded. Each segment is a flat list of integers,
// [lat, lon, alt, Δlat, Δlon, Δalt, …]: latitude and longitude in 1e-5° (about 1 m) and
// altitude in decimetres, each a change from the previous point; a missing altitude is null.

import { CourseError, MAX_OPEN_POINTS, courseSegments, writeCourseGPX } from './courseFile.js';
import { haversine } from '../geo/geo.js';
import { verticalGainLoss } from '../stats/summary.js';

export const LINK_PARAM = 'c';
/** Where Locale Viewer is hosted (GitHub Pages, .github/workflows/viewer-pages.yml). */
export const VIEWER_URL = 'https://andrewrigney1975-cpu.github.io/ar-localetracker/';
const VERSION = 1;
const DEG = 1e5;
const ALT = 10;

/** Links longer than this are refused: chat apps and some browsers cut very long URLs. */
export const MAX_LINK_CHARS = 60000;
/**
 * Most JSON a link may inflate to. A link at the length limit holds ~45 kB of deflate, which
 * real courses inflate to a few hundred kB; deflate can expand ~1000×, so a crafted link
 * could otherwise fill the tab's memory.
 */
const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

export class CourseLinkError extends Error {}

const DAMAGED = 'This course link is incomplete or damaged. Ask for the link again, or for the .gpx file.';

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** Inflated bytes, read a chunk at a time so a deflate bomb stops at the cap. */
async function inflate(bytes, cap) {
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      throw new CourseLinkError(DAMAGED);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function toBase64Url(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function packSegment(pts) {
  const out = [];
  let lat = 0;
  let lon = 0;
  let alt = 0;
  for (const [la, lo, al] of pts) {
    const qa = Math.round(la * DEG);
    const qo = Math.round(lo * DEG);
    out.push(qa - lat, qo - lon);
    lat = qa;
    lon = qo;
    if (Number.isFinite(al)) {
      const q = Math.round(al * ALT);
      out.push(q - alt);
      alt = q;
    } else out.push(null);
  }
  return out;
}

/** Whole numbers only (altitude may be null): anything else would give NaN coordinates. */
function validSegment(flat) {
  if (!Array.isArray(flat) || flat.length % 3) return false;
  for (let k = 0; k < flat.length; k++) {
    if (!Number.isSafeInteger(flat[k]) && !(k % 3 === 2 && flat[k] === null)) return false;
  }
  return true;
}

function unpackSegment(flat) {
  const pts = [];
  let lat = 0;
  let lon = 0;
  let alt = 0;
  for (let k = 0; k < flat.length; k += 3) {
    lat += flat[k];
    lon += flat[k + 1];
    let a = NaN;
    if (flat[k + 2] != null) {
      alt += flat[k + 2];
      a = alt / ALT;
    }
    pts.push([lat / DEG, lon / DEG, a]);
  }
  return pts;
}

/**
 * The fragment value for a course ({name, sharedBy, activity, trimmed, track} as from
 * parseCourse). The route is thinned the same way as a shared course file.
 */
export async function encodeCourseLink(course) {
  const { segments } = courseSegments(course.track);
  const payload = { v: VERSION, n: course.name || 'Course', s: segments.map(packSegment) };
  if (course.sharedBy) payload.b = course.sharedBy;
  if (course.activity) payload.a = course.activity;
  if (course.trimmed) payload.t = 1;
  const json = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(await pipe(json, new CompressionStream('deflate-raw')));
}

/** The full Locale Viewer link for a course, or null when it is too detailed for a link. */
export async function courseLinkURL(course) {
  const value = await encodeCourseLink(course);
  return value.length <= MAX_LINK_CHARS ? `${VIEWER_URL}#${LINK_PARAM}=${value}` : null;
}

/**
 * The course GPX a link carries, ready for parseCourse.
 * Links come from anyone, so the size is checked at each step: the link's length, the
 * inflated JSON, then the number of points before any are unpacked.
 * @throws {CourseLinkError} when the link is damaged, too large or from a newer version
 * @throws {CourseError} when the route has more points than View can draw
 */
export async function decodeCourseLink(value) {
  if (typeof value !== 'string' || value.length > MAX_LINK_CHARS) {
    throw new CourseLinkError('This course link is longer than Locale makes. Ask for the .gpx file instead.');
  }
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(await inflate(fromBase64Url(value), MAX_PAYLOAD_BYTES)));
  } catch {
    throw new CourseLinkError(DAMAGED);
  }
  if (payload?.v !== VERSION) throw new CourseLinkError('This course link is from a newer version of Locale.');
  const flat = payload.s ?? [];
  if (!Array.isArray(flat) || !flat.every(validSegment)) throw new CourseLinkError(DAMAGED);
  const n = flat.reduce((s, x) => s + x.length / 3, 0);
  if (n > MAX_OPEN_POINTS) throw new CourseError(`This route has ${n.toLocaleString()} points, more than View can draw (${MAX_OPEN_POINTS.toLocaleString()}).`);
  const segments = flat.map(unpackSegment);
  let distance = 0;
  let gain = 0;
  let loss = 0;
  for (const pts of segments) {
    for (let k = 1; k < pts.length; k++) distance += haversine(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1]);
    const gl = verticalGainLoss(Float64Array.from(pts, (p) => p[2]), 3);
    gain += gl.gain;
    loss += gl.loss;
  }
  return writeCourseGPX(
    { name: String(payload.n ?? ''), initials: payload.b ? String(payload.b) : '', activity: payload.a ?? null, distance, gain, loss, trimmed: payload.t === 1 },
    segments
  );
}

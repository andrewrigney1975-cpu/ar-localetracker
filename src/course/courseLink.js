// Course links: a whole course packed into a URL fragment (`#c=…`) for the web Viewer, so a
// course can be shared as a link that opens in any browser. The fragment never reaches a
// server. Like a course file, a link carries route and altitude only.
//
// Payload: JSON {v, n (name), b (shared by), a (activity), t (start and finish hidden),
// s (segments)}, deflated and base64url-encoded. Each segment is a flat list of integers,
// [lat, lon, alt, Δlat, Δlon, Δalt, …]: latitude and longitude in 1e-5° (about 1 m) and
// altitude in decimetres, each a change from the previous point; a missing altitude is null.

import { courseSegments, writeCourseGPX } from './courseFile.js';
import { haversine } from '../geo/geo.js';
import { verticalGainLoss } from '../stats/summary.js';

export const LINK_PARAM = 'c';
const VERSION = 1;
const DEG = 1e5;
const ALT = 10;

/** Links longer than this are refused: chat apps and some browsers cut very long URLs. */
export const MAX_LINK_CHARS = 60000;

export class CourseLinkError extends Error {}

async function pipe(bytes, stream) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
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

function unpackSegment(flat) {
  if (!Array.isArray(flat) || flat.length % 3) throw new CourseLinkError('This course link is damaged.');
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

/**
 * The course GPX a link carries, ready for parseCourse.
 * @throws {CourseLinkError} when the link is damaged or from a newer version
 */
export async function decodeCourseLink(value) {
  let payload;
  try {
    const bytes = await pipe(fromBase64Url(value), new DecompressionStream('deflate-raw'));
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CourseLinkError('This course link is incomplete or damaged. Ask for the link again, or for the .gpx file.');
  }
  if (payload?.v !== VERSION) throw new CourseLinkError('This course link is from a newer version of Locale.');
  const segments = (payload.s ?? []).map(unpackSegment);
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

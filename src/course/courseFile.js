// Shared courses (docs/plans/view-workout.md): a workout's route and altitude as a GPX 1.1
// track with no time, speed, heart rate or other performance data, and the parser the View
// tool uses to open one (or any GPX/GeoJSON route) as a CourseTrack.
//
// A CourseTrack has the usual Track columns so the map, profile and 3D code can draw it, but
// only lat, lon, alt, dist and seg carry data; t, speed, active and moving are zero and the
// views run in course mode, which never shows them.

import { activity as activityProfile } from '../activities.js';
import { bbox as computeBbox, haversine, makeProjection, simplifyIndices } from '../geo/geo.js';
import { allocTrack, smoothAltitude } from '../geo/process.js';
import { verticalGainLoss } from '../stats/summary.js';
import { esc } from '../export/xml.js';

export const COURSE_NS = 'https://locale.app/xmlschemas/course/v1';
export const COURSE_MIME = 'application/gpx+xml';

const THIN_TOLERANCE_M = 2;
const MAX_SHARED_POINTS = 5000;
const MAX_OPEN_POINTS = 50000;
const HIDE_ENDS_M = 200;

// ---- Initials and file name ------------------------------------------------------------------

/** "Andrew Rigney" → "AR", "andrew" → "A", "AR" → "AR", "Mary-Jane van Dyke" → "MD". */
export function initialsOf(name) {
  const s = String(name ?? '').trim();
  if (!s) return '';
  // Already initials ("AR", "A.R.").
  const compact = s.replace(/[.\s]/g, '');
  if (/^\p{Lu}{1,3}$/u.test(compact)) return compact;
  const words = s.split(/\s+/).filter(Boolean);
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : '';
  return (first[0] + (last ? last[0] : '')).toUpperCase();
}

/** "AR Bondi loop.gpx": initials, a space, the label; unsafe characters become spaces. */
export function courseFilename(initials, label) {
  const clean = (s) =>
    String(s ?? '')
      .replace(/[/\\:*?"<>|\u0000-\u001f\u007f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const base = [clean(initials), clean(label) || 'Course'].filter(Boolean).join(' ').slice(0, 80).trim();
  return `${base}.gpx`;
}

// ---- Writing -----------------------------------------------------------------------------------

/**
 * Index ranges [from, to) of the track to share, per segment, after optionally hiding the
 * first and last 200 m (20% each end on routes under 1 km).
 */
export function sharedRanges(track, { hideEnds = false } = {}) {
  const n = track.n;
  const total = n ? track.dist[n - 1] : 0;
  const trim = hideEnds ? (total < 5 * HIDE_ENDS_M ? total * 0.2 : HIDE_ENDS_M) : 0;
  const lo = trim;
  const hi = total - trim;
  const ranges = [];
  let s = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || track.seg[i] !== track.seg[s]) {
      let a = s;
      let b = i;
      while (a < b && track.dist[a] < lo) a++;
      while (b > a && track.dist[b - 1] > hi) b--;
      if (b - a >= 2) ranges.push([a, b]);
      s = i;
    }
  }
  return ranges;
}

/** Indices to keep in [from, to): Douglas–Peucker on position and on the altitude profile. */
function thin(track, from, to, tolerance) {
  const m = to - from;
  if (m <= 2) return Array.from({ length: m }, (_, k) => from + k);
  const proj = makeProjection(track.lat[from], track.lon[from]);
  const xs = new Float64Array(m);
  const ys = new Float64Array(m);
  const ds = new Float64Array(m);
  const as = new Float64Array(m);
  let lastAlt = 0;
  for (let k = 0; k < m; k++) {
    [xs[k], ys[k]] = proj.toXY(track.lat[from + k], track.lon[from + k]);
    ds[k] = track.dist[from + k];
    const a = track.alt[from + k];
    if (Number.isFinite(a)) lastAlt = a;
    as[k] = lastAlt;
  }
  const keep = new Set([...simplifyIndices(xs, ys, tolerance), ...simplifyIndices(ds, as, tolerance)]);
  return [...keep].sort((a, b) => a - b).map((k) => from + k);
}

/**
 * The course GPX for a workout: route and altitude only.
 * @param {object} workout  stored workout record (name, activity)
 * @param {object} track    processed track
 * @param {{initials?:string, hideEnds?:boolean}} [opts]
 * @returns {{text:string, points:number, distance:number, gain:number, loss:number}}
 */
export function toCourseGPX(workout, track, { initials = '', hideEnds = false } = {}) {
  const ranges = sharedRanges(track, { hideEnds });
  let tolerance = THIN_TOLERANCE_M;
  let segments;
  for (;;) {
    segments = ranges.map(([a, b]) => thin(track, a, b, tolerance));
    if (segments.reduce((s, x) => s + x.length, 0) <= MAX_SHARED_POINTS || tolerance > 500) break;
    tolerance *= 1.6;
  }
  const points = segments.reduce((s, x) => s + x.length, 0);
  // Headline numbers from exactly what is written, so they match what the recipient sees.
  let distance = 0;
  let gain = 0;
  let loss = 0;
  for (const idx of segments) {
    for (let k = 1; k < idx.length; k++) distance += haversine(track.lat[idx[k - 1]], track.lon[idx[k - 1]], track.lat[idx[k]], track.lon[idx[k]]);
    const gl = verticalGainLoss(Float64Array.from(idx, (i) => track.alt[i]), 3);
    gain += gl.gain;
    loss += gl.loss;
  }
  const name = workout.name || 'Course';
  const act = activityProfile(workout.activity).id;
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<gpx version="1.1" creator="Locale Exercise Tracker" xmlns="http://www.topografix.com/GPX/1/1" xmlns:locale="${COURSE_NS}">`,
    '  <metadata>',
    `    <name>${esc(name)}</name>`,
    ...(initials ? [`    <author><name>${esc(initials)}</name></author>`] : []),
    `    <extensions><locale:course v="1" activity="${act}" distance="${distance.toFixed(1)}" gain="${Math.round(gain)}" loss="${Math.round(loss)}"${hideEnds ? ' trimmed="1"' : ''}/></extensions>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${esc(name)}</name>`,
    `    <type>${act}</type>`,
  ];
  for (const idx of segments) {
    lines.push('    <trkseg>');
    for (const i of idx) {
      const ele = Number.isFinite(track.alt[i]) ? `<ele>${track.alt[i].toFixed(1)}</ele>` : '';
      lines.push(`      <trkpt lat="${track.lat[i].toFixed(6)}" lon="${track.lon[i].toFixed(6)}">${ele}</trkpt>`);
    }
    lines.push('    </trkseg>');
  }
  lines.push('  </trk>', '</gpx>');
  return { text: lines.join('\n') + '\n', points, distance, gain, loss };
}

// ---- Reading -----------------------------------------------------------------------------------

const tag = (name) => `(?:[\\w-]+:)?${name}`;
const attr = (attrs, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return m ? (m[1] ?? m[2]) : null;
};
const unescapeXml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&')
    .trim();
const textOf = (xml, name) => {
  const m = new RegExp(`<${tag(name)}\\b[^>]*>([\\s\\S]*?)</${tag(name)}>`).exec(xml);
  return m ? unescapeXml(m[1]) : null;
};

export class CourseError extends Error {}

/** Points of every <trkseg> (or the whole <rte>) as [[lat, lon, ele], …] per segment. */
function gpxSegments(xml) {
  const pointsIn = (block, el) => {
    const pts = [];
    const re = new RegExp(`<${tag(el)}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tag(el)}>)`, 'g');
    let m;
    while ((m = re.exec(block))) {
      const lat = Number(attr(m[1], 'lat'));
      const lon = Number(attr(m[1], 'lon'));
      const eleText = m[2] ? textOf(m[2], 'ele') : null;
      pts.push([lat, lon, eleText != null && eleText !== '' ? Number(eleText) : NaN]);
    }
    return pts;
  };
  const segs = [];
  const segRe = new RegExp(`<${tag('trkseg')}\\b[^>]*>([\\s\\S]*?)</${tag('trkseg')}>`, 'g');
  let m;
  while ((m = segRe.exec(xml))) segs.push(pointsIn(m[1], 'trkpt'));
  if (!segs.some((s) => s.length)) {
    const rteRe = new RegExp(`<${tag('rte')}\\b[^>]*>([\\s\\S]*?)</${tag('rte')}>`, 'g');
    while ((m = rteRe.exec(xml))) segs.push(pointsIn(m[1], 'rtept'));
  }
  return segs.filter((s) => s.length);
}

const block = (xml, name) => new RegExp(`<${tag(name)}\\b[^>]*>([\\s\\S]*?)</${tag(name)}>`).exec(xml)?.[1] ?? '';

function parseGPX(text) {
  const metadata = block(text, 'metadata');
  const author = block(metadata, 'author');
  // <name> and <type> of the metadata and track themselves, not of the author or points.
  const metaOwn = metadata.replace(new RegExp(`<${tag('author')}[\\s\\S]*?</${tag('author')}>`), '');
  const trkOwn = block(text, 'trk').replace(new RegExp(`<${tag('trkseg')}[\\s\\S]*`), '');
  const ext = /<(?:[\w-]+:)?course\b([^>]*?)\/?>/.exec(metadata)?.[1] ?? null;
  return {
    name: textOf(metaOwn, 'name') || textOf(trkOwn, 'name') || textOf(block(text, 'rte'), 'name'),
    sharedBy: author ? textOf(author, 'name') : null,
    activity: (ext && attr(ext, 'activity')) || textOf(trkOwn, 'type'),
    locale: Boolean(ext),
    trimmed: Boolean(ext && attr(ext, 'trimmed') === '1'),
    segments: gpxSegments(text),
  };
}

function parseGeoJSON(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new CourseError('This file is not a GPX or GeoJSON course.');
  }
  const segments = [];
  let name = null;
  const take = (geom, props) => {
    if (!geom) return;
    if (props?.name && !name) name = String(props.name);
    if (geom.type === 'LineString') segments.push(geom.coordinates);
    else if (geom.type === 'MultiLineString') segments.push(...geom.coordinates);
    else if (geom.type === 'GeometryCollection') geom.geometries?.forEach((g) => take(g, null));
  };
  if (doc?.type === 'FeatureCollection') {
    if (doc.properties?.name) name = String(doc.properties.name);
    doc.features?.forEach((f) => take(f.geometry, f.properties));
  } else if (doc?.type === 'Feature') take(doc.geometry, doc.properties);
  else take(doc, null);
  return {
    name,
    sharedBy: null,
    activity: null,
    locale: false,
    trimmed: false,
    segments: segments.map((s) => s.map(([lon, lat, ele]) => [Number(lat), Number(lon), ele == null ? NaN : Number(ele)])),
  };
}

/**
 * Open a course file. Timing, speed and heart rate in the file (e.g. a full GPX export from
 * another app) are ignored: View is course-only.
 * @returns {{name:string, sharedBy:string|null, activity:string|null, track:object, summary:object, trimmed:boolean}}
 */
export function parseCourse(text, filename = '') {
  const src = String(text ?? '').replace(/^﻿/, '');
  const looksXml = /^\s*</.test(src);
  const parsed = looksXml ? parseGPX(src) : parseGeoJSON(src);
  const segments = parsed.segments.map((s) =>
    s.filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
  ).filter((s) => s.length);
  const n = segments.reduce((s, x) => s + x.length, 0);
  if (n < 2) throw new CourseError('No route found in this file.');
  if (n > MAX_OPEN_POINTS) throw new CourseError(`This route has ${n.toLocaleString()} points, more than View can draw (${MAX_OPEN_POINTS.toLocaleString()}).`);

  const track = allocTrack(n);
  let i = 0;
  segments.forEach((pts, s) => {
    pts.forEach(([lat, lon, ele], k) => {
      track.lat[i] = lat;
      track.lon[i] = lon;
      track.alt[i] = ele;
      track.seg[i] = s;
      track.course[i] = NaN;
      track.acc[i] = NaN;
      if (i > 0) track.dist[i] = track.dist[i - 1] + (k > 0 ? haversine(track.lat[i - 1], track.lon[i - 1], lat, lon) : 0);
      i++;
    });
  });
  // Locale's own courses are already smoothed; others get the GPS-only smoothing.
  if (!parsed.locale) smoothAltitude(track.alt, false);
  const fallbackName = String(filename).replace(/\.[^.]+$/, '').trim();
  const act = parsed.activity && activityProfile(parsed.activity).id === parsed.activity ? parsed.activity : null;
  return {
    name: parsed.name || fallbackName || 'Course',
    sharedBy: parsed.sharedBy || null,
    activity: act,
    trimmed: parsed.trimmed,
    track,
    summary: courseSummary(track),
  };
}

/** Distance and altitude summary of a CourseTrack (the fields the map and 3D views read). */
export function courseSummary(track) {
  const n = track.n;
  let minAlt = Infinity;
  let maxAlt = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = track.alt[i];
    if (Number.isFinite(a)) {
      minAlt = Math.min(minAlt, a);
      maxAlt = Math.max(maxAlt, a);
    }
  }
  const { gain, loss } = verticalGainLoss(track.alt, 3);
  const hasAlt = Number.isFinite(minAlt);
  return {
    distance: n ? track.dist[n - 1] : 0,
    elevGain: gain,
    elevLoss: loss,
    minAlt: hasAlt ? minAlt : null,
    maxAlt: hasAlt ? maxAlt : null,
    pointCount: n,
    segments: n ? track.seg[n - 1] + 1 : 0,
    bbox: n ? computeBbox(track.lat, track.lon, n) : null,
  };
}

/** Stable id for a course's content (FNV-1a), so opening the same file twice reuses it. */
export function courseId(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `c${h.toString(16).padStart(8, '0')}${s.length.toString(36)}`;
}

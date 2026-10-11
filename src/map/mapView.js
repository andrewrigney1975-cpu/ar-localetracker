// Overhead map: speed-coloured track, direction arrows, distance markers with popovers,
// a draggable scrub marker, and the linked elevation profile below.

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { sampleAtDistance } from '../geo/process.js';
import { TrackSnapper } from '../geo/snap.js';
import { ElevationProfile } from '../profile/elevationProfile.js';
import { distanceMarkers, verticalGainLoss } from '../stats/summary.js';
import { rampCSS, rampHex, speedRange } from '../ui/colors.js';
import { cssVar, Disposer, el, escapeHtml } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { markerInfoHTML, Popover } from '../ui/popover.js';
import {
  distanceUnit,
  formatAltitude,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  speedValue,
  speedUnit,
  splitLength,
} from '../units.js';

// MapLibre locates its worker relative to import.meta.url, which bundling breaks; point it explicitly.
maplibregl.setWorkerUrl(workerUrl);

const OSM_ATTR = '© <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';

export const MAP_STYLES = {
  streets: { label: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
  light: { label: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
  dark: { label: 'Dark', style: 'https://tiles.openfreemap.org/styles/dark' },
  topo: {
    label: 'Topo',
    style: {
      version: 8,
      sources: {
        otm: {
          type: 'raster',
          tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
          tileSize: 256,
          maxzoom: 17,
          attribution: `${OSM_ATTR}, SRTM | Style: © <a href="https://opentopomap.org" target="_blank">OpenTopoMap</a> (CC-BY-SA)`,
        },
      },
      layers: [{ id: 'otm', type: 'raster', source: 'otm' }],
    },
  },
};

const BLANK_STYLE = (bg) => ({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }] });

/**
 * @param {HTMLElement} root  panel to render into
 * @param {{workout:object, track:object, units:string, styleId:string, activityAccent:string, preferSpeed:boolean, course?:boolean, onStyleChange?:(id:string)=>void}} opts
 *   course: a shared course (View): one-colour line, no legend, and no time, speed or heart
 *   rate anywhere, since the track carries none
 * @returns {() => void} dispose
 */
export function mountMapView(root, { workout, track, units, styleId = 'streets', preferSpeed = false, course = false, onStyleChange }) {
  const d = new Disposer();
  const splitLen = splitLength(units);
  root.innerHTML = `
    <div class="map-layout">
      <div class="map-wrap">
        <div class="map"></div>
        <div class="map-tools">
          <button data-act="style" aria-label="Map style">${icons.layers}</button>
          <button data-act="fit" aria-label="Fit route">${icons.recenter}</button>
        </div>
        ${course ? '' : `<div class="legend" aria-hidden="true"><span>Speed (${speedUnit(units)})</span><div class="ramp"></div><div class="ends"><span class="lo"></span><span class="hi"></span></div></div>`}
      </div>
      <div class="readout" aria-live="polite"></div>
      <div class="profile"></div>
    </div>`;
  const wrap = root.querySelector('.map-wrap');
  const mapEl = root.querySelector('.map');
  const readout = root.querySelector('.readout');
  const [vmin, vmax] = course ? [0, 1] : speedRange(track);
  if (!course) {
    root.querySelector('.legend .ramp').style.background = rampCSS();
    root.querySelector('.legend .lo').textContent = speedValue(vmin, units).toFixed(0);
    root.querySelector('.legend .hi').textContent = speedValue(vmax, units).toFixed(0);
  }

  if (track.n < 2) {
    mapEl.innerHTML = '<div class="map-offline">Not enough GPS points to draw a map.</div>';
    return () => d.dispose();
  }

  const bounds = workout.summary.bbox;
  let currentStyle = MAP_STYLES[styleId] ? styleId : 'streets';
  const map = new maplibregl.Map({
    container: mapEl,
    style: MAP_STYLES[currentStyle].style,
    bounds: [
      [bounds[0], bounds[1]],
      [bounds[2], bounds[3]],
    ],
    fitBoundsOptions: { padding: 48 },
    attributionControl: { compact: true },
    pitchWithRotate: false,
    dragRotate: false,
    maxPitch: 0,
  });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.ScaleControl({ unit: units === 'imperial' ? 'imperial' : 'metric' }), 'bottom-right');
  d.add(() => map.remove());

  const geo = buildGeoJSON(track, vmin, vmax, course ? cssVar('--accent', root) || '#f2672e' : null);
  const popover = new Popover(wrap);
  let popAnchor = null;
  const placePopover = () => {
    if (!popAnchor || !popover.open) return;
    const p = map.project(popAnchor);
    popover.move(p.x, p.y);
  };
  map.on('move', placePopover);
  d.add(() => popover.close(false));

  // Layers are re-added after every style change.
  let styleFailed = false;
  map.on('style.load', () => addTrackLayers(map, geo));
  map.on('error', (e) => {
    // Offline or tile server unreachable: fall back to a blank background so the track still shows.
    if (!map.isStyleLoaded() && !styleFailed) {
      styleFailed = true;
      map.setStyle(BLANK_STYLE(cssVar('--surface-2') || '#ddd'));
      wrap.appendChild(el('<div class="map-offline"><span>Map tiles unavailable offline. Route shown without basemap.</span></div>'));
    } else if (e?.error) {
      console.warn('map', e.error.message ?? e.error);
    }
  });

  // Distance markers + start/finish.
  const markers = distanceMarkers(track, splitLen);
  const unit = distanceUnit(units);
  const openInfo = (title, sample) => {
    popAnchor = [sample.lon, sample.lat];
    const p = map.project(popAnchor);
    popover.show(p.x, p.y, markerInfoHTML({ title, sample, units, course }));
  };
  for (const m of markers) {
    const node = el(`<div class="km-marker" role="button" aria-label="${m.k} ${unit} marker">${m.k}</div>`);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      const prev = markers[m.k - 2];
      const splitTime = m.active - (prev ? prev.active : 0);
      openInfo(`${m.k} ${unit}`, course ? m : { ...m, extra: [['Split pace', formatPace(splitLen / Math.max(1, splitTime), units)]] });
    });
    new maplibregl.Marker({ element: node }).setLngLat([m.lon, m.lat]).addTo(map);
  }
  const first = sampleAtDistance(track, 0);
  const last = sampleAtDistance(track, track.dist[track.n - 1]);
  const endpoint = (cls, title, s) => {
    const node = el(`<div class="endpoint-marker ${cls}" role="button" aria-label="${title}"></div>`);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      openInfo(title, s);
    });
    new maplibregl.Marker({ element: node }).setLngLat([s.lon, s.lat]).addTo(map);
  };
  endpoint('finish', 'Finish', last);
  endpoint('start', 'Start', first);

  // Scrub marker linked with the profile.
  const snapper = new TrackSnapper(track);
  const scrubEl = el('<div class="scrubber" aria-label="Drag along the route"></div>');
  const scrub = new maplibregl.Marker({ element: scrubEl, draggable: true }).setLngLat([first.lon, first.lat]).addTo(map);
  const profile = new ElevationProfile(root.querySelector('.profile'), {
    track,
    units,
    splitLen,
    onScrub: (dist) => setCursor(dist, 'profile'),
  });
  d.add(() => profile.destroy());

  function setCursor(dist, source) {
    const s = sampleAtDistance(track, dist);
    if (source !== 'map') scrub.setLngLat([s.lon, s.lat]);
    if (source !== 'profile') profile.setCursor(dist);
    if (source === 'profile' && !map.getBounds().contains([s.lon, s.lat])) map.panTo([s.lon, s.lat], { duration: 200 });
    lastCursor = s;
    renderReadout(s);
  }

  scrub.on('drag', () => {
    const ll = scrub.getLngLat();
    const hit = snapper.nearest(ll.lat, ll.lng);
    if (!hit) return;
    const s = sampleAtDistance(track, hit.dist);
    scrub.setLngLat([s.lon, s.lat]);
    setCursor(hit.dist, 'map');
  });

  // Tapping near the line jumps the scrubber there.
  map.on('click', (e) => {
    if (popover.open) {
      popover.close();
      return;
    }
    const box = [
      [e.point.x - 14, e.point.y - 14],
      [e.point.x + 14, e.point.y + 14],
    ];
    if (!map.getLayer('track-hit') || !map.queryRenderedFeatures(box, { layers: ['track-hit'] }).length) return;
    const hit = snapper.nearest(e.lngLat.lat, e.lngLat.lng);
    if (hit) setCursor(hit.dist, 'click');
  });

  const hasHr = !course && Boolean(track.hr) && Array.from(track.hr).some(Number.isFinite);
  const gradeText = (grade) => `${grade >= 0 ? '+' : '−'}${Math.abs(grade).toFixed(1)}%`;
  const readoutHTML = ({ dist, active, alt, speed, grade, hr, climb }) =>
    (course
      ? [
          ['', formatDistance(dist, units)],
          ['Alt', formatAltitude(alt, units)],
          ['Grade', gradeText(grade)],
          ['Climb', `+${formatAltitude(climb, units)}`],
        ]
      : [
          ['', formatDistance(dist, units)],
          ['', formatDuration(active)],
          ['Alt', formatAltitude(alt, units)],
          ['', preferSpeed ? formatSpeed(speed, units) : formatPace(speed, units)],
          ['Grade', gradeText(grade)],
          // Always present when the workout has heart rate, so the line never gains an item.
          ...(hasHr ? [['♥', Number.isFinite(hr) ? `${Math.round(hr)}` : '–']] : []),
        ]
    )
      .map(([k, v]) => `<span>${k ? `${k} ` : ''}<b>${escapeHtml(v)}</b></span>`)
      .join('');

  function renderReadout(s) {
    const back = sampleAtDistance(track, Math.max(0, s.dist - 25));
    const fwd = sampleAtDistance(track, s.dist + 25);
    const run = fwd.dist - back.dist;
    const grade = run > 5 ? ((fwd.alt - back.alt) / run) * 100 : 0;
    // Courses: climb from the start to the cursor, with the same hysteresis as the summary.
    const climb = course ? verticalGainLoss(track.alt, 3, 0, s.index + 1).gain : 0;
    readout.innerHTML = readoutHTML({ ...s, grade, climb });
  }

  /**
   * Keep the readout on one line at a fixed size: fit the font once to the widest values
   * this workout can show (longest distance and time, highest altitude, slowest pace,
   * a steep grade), instead of reacting as values change under the cursor.
   */
  function fitReadout() {
    const n = track.n;
    let maxAlt = 0;
    for (let i = 0; i < n; i++) if (Number.isFinite(track.alt[i])) maxAlt = Math.max(maxAlt, Math.abs(track.alt[i]));
    readout.style.fontSize = '';
    readout.innerHTML = readoutHTML({
      dist: n ? track.dist[n - 1] : 0,
      active: n ? track.active[n - 1] : 0,
      alt: -maxAlt || -888,
      speed: preferSpeed ? 88 : 0, // fastest speed / "–:––" pace are the widest
      grade: -88.8,
      hr: 188,
      climb: workout.summary.elevGain ?? 8888,
    });
    const base = parseFloat(getComputedStyle(readout).fontSize);
    let size = base;
    while (readout.scrollWidth > readout.clientWidth && size > base * 0.6) {
      size -= 0.5;
      readout.style.fontSize = `${size}px`;
    }
  }
  let lastCursor = first;
  fitReadout();
  renderReadout(first);
  // Rotation or a resized window: refit to the new width.
  let lastWidth = readout.clientWidth;
  const ro = new ResizeObserver(() => {
    if (readout.clientWidth === lastWidth) return;
    lastWidth = readout.clientWidth;
    fitReadout();
    renderReadout(lastCursor);
  });
  ro.observe(readout);
  d.add(() => ro.disconnect());
  profile.setCursor(0);

  // Tools.
  const fit = () =>
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      { padding: 48, duration: 400 }
    );
  root.querySelector('[data-act="fit"]').addEventListener('click', fit);
  root.querySelector('[data-act="style"]').addEventListener('click', () => {
    const ids = Object.keys(MAP_STYLES);
    currentStyle = ids[(ids.indexOf(currentStyle) + 1) % ids.length];
    styleFailed = false;
    map.setStyle(MAP_STYLES[currentStyle].style);
    onStyleChange?.(currentStyle);
    showStyleName(wrap, MAP_STYLES[currentStyle].label);
  });

  return () => d.dispose();
}

function showStyleName(wrap, label) {
  wrap.querySelector('.style-flash')?.remove();
  const n = el(`<div class="view3d-hint style-flash">${escapeHtml(label)}</div>`);
  wrap.appendChild(n);
  setTimeout(() => n.remove(), 1200);
}

/** Track features; `color` draws the whole line in one colour (courses) instead of by speed. */
function buildGeoJSON(track, vmin, vmax, color = null) {
  const n = track.n;
  const chunk = Math.max(2, Math.ceil(n / 700));
  const colored = [];
  const lines = [];
  const gaps = [];
  let segStart = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || track.seg[i] !== track.seg[segStart]) {
      const coords = [];
      for (let k = segStart; k < i; k++) coords.push([track.lon[k], track.lat[k]]);
      if (coords.length >= 2) lines.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
      for (let a = segStart; a < i - 1; a += chunk) {
        const b = Math.min(i - 1, a + chunk);
        let v = 0;
        for (let k = a; k <= b; k++) v += track.speed[k];
        v /= b - a + 1;
        colored.push({
          type: 'Feature',
          properties: { color: color ?? rampHex((v - vmin) / (vmax - vmin)) },
          geometry: { type: 'LineString', coordinates: coords.slice(a - segStart, b - segStart + 1) },
        });
      }
      if (i < n) {
        gaps.push({
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: [[track.lon[i - 1], track.lat[i - 1]], [track.lon[i], track.lat[i]]] },
        });
      }
      segStart = i;
    }
  }
  return {
    colored: { type: 'FeatureCollection', features: colored },
    line: { type: 'FeatureCollection', features: lines },
    gaps: { type: 'FeatureCollection', features: gaps },
  };
}

function arrowImage() {
  // Chevron pointing along +x (symbol-placement: line aligns +x with the line direction).
  const size = 40;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const path = () => {
    g.beginPath();
    g.moveTo(14, 11);
    g.lineTo(25, 20);
    g.lineTo(14, 29);
  };
  path();
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 8;
  g.stroke();
  path();
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 4.5;
  g.stroke();
  return g.getImageData(0, 0, size, size);
}

function addTrackLayers(map, geo) {
  if (map.getSource('track-colored')) return;
  if (!map.hasImage('route-arrow')) map.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
  map.addSource('track-colored', { type: 'geojson', data: geo.colored });
  map.addSource('track-line', { type: 'geojson', data: geo.line });
  map.addSource('track-gaps', { type: 'geojson', data: geo.gaps });

  map.addLayer({
    id: 'track-gaps',
    type: 'line',
    source: 'track-gaps',
    paint: { 'line-color': '#7a8794', 'line-width': 2.5, 'line-dasharray': [1.5, 2] },
  });
  map.addLayer({
    id: 'track-casing',
    type: 'line',
    source: 'track-line',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#0b1015', 'line-opacity': 0.55, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 9] },
  });
  map.addLayer({
    id: 'track',
    type: 'line',
    source: 'track-colored',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2.5, 16, 6] },
  });
  map.addLayer({
    id: 'track-hit',
    type: 'line',
    source: 'track-line',
    paint: { 'line-color': '#000', 'line-opacity': 0.001, 'line-width': 24 },
  });
  map.addLayer({
    id: 'track-arrows',
    type: 'symbol',
    source: 'track-line',
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': ['interpolate', ['linear'], ['zoom'], 10, 60, 16, 110],
      'icon-image': 'route-arrow',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.55, 16, 0.85],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
    paint: { 'icon-opacity': 0.7 },
  });
}

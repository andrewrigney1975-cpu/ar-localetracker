// Small live map for the Live position screen: a position dot with an accuracy circle that
// follows the fix until the user pans; the recenter button re-enables following.

import * as maplibregl from 'maplibre-gl';
import { destination } from '../geo/geo.js';
import { cssVar, el } from '../ui/dom.js';
import { icons } from '../ui/icons.js';
import { MAP_STYLES } from './mapView.js';

function circle(lat, lon, radius, steps = 48) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const [la, lo] = destination(lat, lon, (i / steps) * 360, radius);
    ring.push([lo, la]);
  }
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}

const EMPTY = { type: 'FeatureCollection', features: [] };

/**
 * @param {HTMLElement} host
 * @param {{styleId?: string}} [opts]
 * @returns {{update(fix: {lat:number, lon:number, accuracy?:number}): void, destroy(): void}}
 */
export function createPositionMap(host, { styleId = 'streets' } = {}) {
  host.innerHTML = `<div class="pos-map"></div><button class="pos-map-recenter" aria-label="Follow my position">${icons.recenter}</button>`;
  const mapEl = host.querySelector('.pos-map');
  const recenter = host.querySelector('.pos-map-recenter');
  const map = new maplibregl.Map({
    container: mapEl,
    style: (MAP_STYLES[styleId] ?? MAP_STYLES.streets).style,
    center: [0, 0],
    zoom: 1,
    attributionControl: { compact: true },
    dragRotate: false,
    pitchWithRotate: false,
  });
  map.touchZoomRotate.disableRotation();

  let follow = true;
  let last = null;
  let styleFailed = false;
  const dot = el('<div class="pos-dot" aria-label="Your position"></div>');
  const marker = new maplibregl.Marker({ element: dot });

  const addLayers = () => {
    if (map.getSource('accuracy')) return;
    map.addSource('accuracy', { type: 'geojson', data: last ? circle(last.lat, last.lon, last.accuracy ?? 10) : EMPTY });
    map.addLayer({ id: 'accuracy-fill', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#3b82f6', 'fill-opacity': 0.16 } });
    map.addLayer({ id: 'accuracy-line', type: 'line', source: 'accuracy', paint: { 'line-color': '#3b82f6', 'line-opacity': 0.5, 'line-width': 1.5 } });
  };
  map.on('style.load', addLayers);
  // Start with the attribution collapsed to its (i) button on this small map.
  map.once('load', () => mapEl.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));
  map.on('error', () => {
    if (!map.isStyleLoaded() && !styleFailed) {
      styleFailed = true;
      map.setStyle({ version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': cssVar('--surface-2') || '#ddd' } }] });
    }
  });
  // A user pan stops following; pinch-zoom alone does not.
  map.on('dragstart', () => {
    follow = false;
    recenter.classList.add('visible');
  });
  recenter.addEventListener('click', () => {
    follow = true;
    recenter.classList.remove('visible');
    if (last) map.easeTo({ center: [last.lon, last.lat], duration: 400 });
  });

  return {
    update(fix) {
      const first = !last;
      last = fix;
      marker.setLngLat([fix.lon, fix.lat]);
      if (first) {
        marker.addTo(map);
        map.jumpTo({ center: [fix.lon, fix.lat], zoom: 16 });
      } else if (follow) {
        map.easeTo({ center: [fix.lon, fix.lat], duration: 600 });
      }
      map.getSource('accuracy')?.setData(circle(fix.lat, fix.lon, Math.max(1, fix.accuracy ?? 10)));
    },
    destroy() {
      map.remove();
    },
  };
}

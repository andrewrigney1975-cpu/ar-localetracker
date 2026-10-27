// Map ground for the 3D view: MapLibre draws the Map tab's style (OpenFreeMap streets by
// default) off-screen over the area, and the picture becomes the ground texture. Replaced
// shaded relief, which replaced Esri World Imagery (it needs an ArcGIS licence to publish).

import * as maplibregl from 'maplibre-gl';
import { MAP_STYLES } from '../map/mapView.js';

/**
 * Longest side of the off-screen map in CSS px. About the size the ground takes on screen, so
 * labels and road widths come out readable in 3D; pixelRatio then adds the sharpness.
 */
const VIEW_PX = 640;
const TIMEOUT_MS = 20000;

export const MAP_GROUND_ATTRIBUTION = {
  topo: 'Map © OpenStreetMap contributors, SRTM · Style © OpenTopoMap (CC-BY-SA)',
  default: 'Map © OpenStreetMap contributors · OpenMapTiles · OpenFreeMap',
};

/** Web Mercator x/y in 0–1 (y grows north), for UVs. */
export const mercX = (lon) => (lon + 180) / 360;
export function mercY(lat) {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return 0.5 + Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** CSS size of an off-screen map covering bbox with its longest side `longest` px. */
export function viewSize([west, south, east, north], longest = VIEW_PX) {
  const w = mercX(east) - mercX(west);
  const h = mercY(north) - mercY(south);
  return w >= h ? { width: longest, height: Math.max(64, Math.round((longest * h) / w)) } : { width: Math.max(64, Math.round((longest * w) / h)), height: longest };
}

/**
 * Render the map over bbox [west, south, east, north].
 * @returns {Promise<{canvas: HTMLCanvasElement, bounds: number[]}>} bounds as drawn (west, south, east, north)
 */
export async function loadMapGround(bbox, styleId, { maxPx = 4096, isCancelled = () => false } = {}) {
  const { width, height } = viewSize(bbox);
  const host = document.createElement('div');
  // Laid out (MapLibre needs a real size) but out of sight.
  host.style.cssText = `position:fixed;left:-${width + 1000}px;top:0;width:${width}px;height:${height}px;pointer-events:none`;
  document.body.appendChild(host);
  let map = null;
  try {
    map = new maplibregl.Map({
      container: host,
      style: (MAP_STYLES[styleId] ?? MAP_STYLES.streets).style,
      bounds: [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ],
      fitBoundsOptions: { padding: 0 },
      interactive: false,
      attributionControl: false,
      fadeDuration: 0,
      pixelRatio: Math.min(8, maxPx / Math.max(width, height)),
      maxCanvasSize: [maxPx, maxPx],
      canvasContextAttributes: { preserveDrawingBuffer: true },
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Map ground timed out')), TIMEOUT_MS);
      map.once('idle', () => {
        clearTimeout(timer);
        resolve();
      });
      map.on('error', (e) => {
        // Offline: the style itself can't load. Missing tiles alone still give a usable map.
        if (!map.isStyleLoaded()) {
          clearTimeout(timer);
          reject(e.error ?? new Error('Map style unavailable'));
        }
      });
    });
    if (isCancelled()) throw new Error('cancelled');
    const src = map.getCanvas();
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    canvas.getContext('2d').drawImage(src, 0, 0);
    const b = map.getBounds();
    return { canvas, bounds: [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()] };
  } finally {
    map?.remove();
    host.remove();
  }
}

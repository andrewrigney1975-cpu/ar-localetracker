// Shaded-relief ground for the 3D view: picks a zoom that fits the area in one texture,
// fetches Terrain Tiles (Terrarium-encoded elevation PNGs, Open Data on AWS: free for any
// use with attribution, no key), decodes them to metres and hill-shades them onto a canvas.
// Replaced Esri World Imagery, whose terms need an ArcGIS licence in a published app.

export const TERRAIN = {
  tileUrl: (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  attribution: 'Elevation: Terrain Tiles (Mapzen, AWS) · SRTM, Geoscience Australia and others',
  // The data is ~30 m (SRTM) in most places, so finer tiles are only upsampled.
  maxZoom: 14,
  tileSize: 256,
};

const TILE = TERRAIN.tileSize;
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6378137;
/**
 * Cells at or below this are drawn as sea. Resampling makes the water ring about ±1 m around
 * 0 near the coast (Sydney Harbour came out as blocky islands with 0 m), so 1.5 m is used.
 */
export const SEA_LEVEL_M = 1.5;

/** Web Mercator world pixel coordinates at zoom z. */
export function lonToPx(lon, z) {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}

export function latToPx(lat, z) {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

/** Highest zoom whose tile-aligned mosaic fits within maxPx and maxTiles. */
export function chooseZoom([west, south, east, north], { maxPx = 4096, maxTiles = 80, maxZoom = TERRAIN.maxZoom } = {}) {
  for (let z = maxZoom; z >= 1; z--) {
    const tx0 = Math.floor(lonToPx(west, z) / TILE);
    const tx1 = Math.floor(lonToPx(east, z) / TILE);
    const ty0 = Math.floor(latToPx(north, z) / TILE);
    const ty1 = Math.floor(latToPx(south, z) / TILE);
    const nx = tx1 - tx0 + 1;
    const ny = ty1 - ty0 + 1;
    if (nx * TILE <= maxPx && ny * TILE <= maxPx && nx * ny <= maxTiles) return { z, tx0, tx1, ty0, ty1, nx, ny };
  }
  return null;
}

/** Metres per pixel of a zoom-z tile at latitude `lat`. */
export function metresPerPixel(lat, z) {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);
}

/**
 * Terrarium RGBA pixels to metres: (R × 256 + G + B / 256) − 32768. Pixels whose alpha is 0
 * (tiles that failed to load) come out NaN.
 */
export function decodeTerrarium(rgba, count) {
  const out = new Float32Array(count);
  for (let i = 0, p = 0; i < count; i++, p += 4) {
    out[i] = rgba[p + 3] === 0 ? NaN : rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
  }
  return out;
}

/**
 * Hill-shade a grid of elevations (Horn's method, sun from the north-west at 45°) into RGBA.
 * Shade runs from `colors.shadow` to `colors.light`; sea (≤ `seaLevel`) is flat `colors.water`, and
 * unknown cells `colors.none`. `zFactor` steepens gentle terrain so it reads at a glance.
 * @param {Float32Array} elev  row-major, width × height
 * @param {number} cell  metres per cell
 * @param {{shadow:number[], light:number[], water:number[], none:number[]}} colors  [r, g, b] 0–255
 * @returns {Uint8ClampedArray}
 */
export function shadeRelief(elev, width, height, cell, colors, { azimuth = 315, altitude = 45, zFactor = 2, seaLevel = SEA_LEVEL_M } = {}) {
  const out = new Uint8ClampedArray(width * height * 4);
  const zenith = ((90 - altitude) * Math.PI) / 180;
  const az = (((360 - azimuth + 90) % 360) * Math.PI) / 180;
  const cosZ = Math.cos(zenith);
  const sinZ = Math.sin(zenith);
  // Clamp at the edges so border cells shade from their own row/column.
  const at = (x, y) => {
    const v = elev[Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))];
    return Number.isFinite(v) ? v : elev[y * width + x];
  };
  const put = (p, [r, g, b]) => {
    out[p] = r;
    out[p + 1] = g;
    out[p + 2] = b;
    out[p + 3] = 255;
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const e = elev[i];
      if (!Number.isFinite(e)) {
        put(p, colors.none);
        continue;
      }
      if (e <= seaLevel) {
        put(p, colors.water);
        continue;
      }
      const a = at(x - 1, y - 1), b = at(x, y - 1), c = at(x + 1, y - 1);
      const d = at(x - 1, y), f = at(x + 1, y);
      const g = at(x - 1, y + 1), h = at(x, y + 1), k = at(x + 1, y + 1);
      const dzdx = (c + 2 * f + k - (a + 2 * d + g)) / (8 * cell);
      const dzdy = (g + 2 * h + k - (a + 2 * b + c)) / (8 * cell);
      const slope = Math.atan(zFactor * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const s = Math.max(0, Math.min(1, cosZ * Math.cos(slope) + sinZ * Math.sin(slope) * Math.cos(az - aspect)));
      out[p] = colors.shadow[0] + (colors.light[0] - colors.shadow[0]) * s;
      out[p + 1] = colors.shadow[1] + (colors.light[1] - colors.shadow[1]) * s;
      out[p + 2] = colors.shadow[2] + (colors.light[2] - colors.shadow[2]) * s;
      out[p + 3] = 255;
    }
  }
  return out;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Needed to read the elevation pixels back (the bucket sends Access-Control-Allow-Origin: *).
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile failed: ${url}`));
    img.src = url;
  });
}

/**
 * Fetch elevation covering bbox [west, south, east, north] and shade it.
 * @returns {Promise<{canvas: HTMLCanvasElement, z: number, originX: number, originY: number, loaded: number, total: number}>}
 *   originX/Y are the world-pixel coordinates of the canvas's top-left corner.
 */
export async function loadTerrain(bbox, colors, { maxPx, maxTiles, concurrency = 6, isCancelled = () => false } = {}) {
  const plan = chooseZoom(bbox, { maxPx, maxTiles });
  if (!plan) throw new Error('Area too large for terrain');
  const { z, tx0, ty0, nx, ny } = plan;
  const canvas = document.createElement('canvas');
  canvas.width = nx * TILE;
  canvas.height = ny * TILE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const jobs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) jobs.push([i, j]);
  let loaded = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !isCancelled()) {
      const [i, j] = jobs[next++];
      try {
        const img = await loadImage(TERRAIN.tileUrl(z, tx0 + i, ty0 + j));
        if (isCancelled()) return;
        ctx.drawImage(img, i * TILE, j * TILE, TILE, TILE);
        loaded++;
      } catch {
        // A missing tile stays transparent and is drawn as unknown ground.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  if (isCancelled()) throw new Error('cancelled');
  if (loaded === 0) throw new Error('Terrain unavailable');
  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height);
  const elev = decodeTerrarium(pixels.data, width * height);
  const midLat = (bbox[1] + bbox[3]) / 2;
  pixels.data.set(shadeRelief(elev, width, height, metresPerPixel(midLat, z), colors));
  ctx.putImageData(pixels, 0, 0);
  return { canvas, z, originX: tx0 * TILE, originY: ty0 * TILE, loaded, total: jobs.length };
}

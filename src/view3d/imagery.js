// Satellite imagery for the 3D ground plane: picks a zoom that fits the area in one
// texture, fetches Web Mercator tiles and stitches them onto a canvas.

export const IMAGERY = {
  tileUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  maxZoom: 18,
  tileSize: 256,
};

const TILE = IMAGERY.tileSize;

/** Web Mercator world pixel coordinates at zoom z. */
export function lonToPx(lon, z) {
  return ((lon + 180) / 360) * TILE * 2 ** z;
}

export function latToPx(lat, z) {
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

/** Highest zoom whose tile-aligned mosaic fits within maxPx and maxTiles. */
export function chooseZoom([west, south, east, north], { maxPx = 4096, maxTiles = 80, maxZoom = IMAGERY.maxZoom } = {}) {
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

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`tile failed: ${url}`));
    img.src = url;
  });
}

/**
 * Fetch and stitch imagery covering bbox [west, south, east, north].
 * @returns {Promise<{canvas: HTMLCanvasElement, z: number, originX: number, originY: number, loaded: number, total: number}>}
 *   originX/Y are the world-pixel coordinates of the canvas's top-left corner.
 */
export async function loadImagery(bbox, { maxPx, maxTiles, concurrency = 6, isCancelled = () => false } = {}) {
  const plan = chooseZoom(bbox, { maxPx, maxTiles });
  if (!plan) throw new Error('Area too large for imagery');
  const { z, tx0, ty0, nx, ny } = plan;
  const canvas = document.createElement('canvas');
  canvas.width = nx * TILE;
  canvas.height = ny * TILE;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#3b4148';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const jobs = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) jobs.push([i, j]);
  let loaded = 0;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length && !isCancelled()) {
      const [i, j] = jobs[next++];
      try {
        const img = await loadImage(IMAGERY.tileUrl(z, tx0 + i, ty0 + j));
        if (isCancelled()) return;
        ctx.drawImage(img, i * TILE, j * TILE, TILE, TILE);
        loaded++;
      } catch {
        // Leave the neutral fill for a missing tile.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  if (!isCancelled() && loaded === 0) throw new Error('Satellite imagery unavailable');
  return { canvas, z, originX: tx0 * TILE, originY: ty0 * TILE, loaded, total: jobs.length };
}

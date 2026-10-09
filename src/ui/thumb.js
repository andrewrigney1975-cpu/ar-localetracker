// Inline SVG route thumbnail from a simplified [lon, lat] polyline.

export function routeThumbSVG(preview, size = 64, pad = 8) {
  if (!preview || preview.length < 2) {
    return `<svg class="thumb" viewBox="0 0 ${size} ${size}" aria-hidden="true"></svg>`;
  }
  const lat0 = preview[0][1];
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const xs = preview.map((p) => p[0] * kx);
  const ys = preview.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1e-6;
  const s = (size - pad * 2) / span;
  const ox = pad + (size - pad * 2 - (maxX - minX) * s) / 2;
  const oy = pad + (size - pad * 2 - (maxY - minY) * s) / 2;
  const pts = xs.map((x, i) => `${(ox + (x - minX) * s).toFixed(1)},${(oy + (maxY - ys[i]) * s).toFixed(1)}`);
  const [sx, sy] = pts[0].split(',');
  return `<svg class="thumb" viewBox="0 0 ${size} ${size}" aria-hidden="true">
    <polyline points="${pts.join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${sx}" cy="${sy}" r="3" fill="currentColor"/>
  </svg>`;
}

import { describe, expect, it, vi } from 'vitest';

vi.mock('maplibre-gl', () => ({}));
vi.mock('../src/map/mapView.js', () => ({ MAP_STYLES: {} }));
const { mercX, mercY, viewSize } = await import('../src/view3d/mapGround.js');

describe('3D map ground', () => {
  it('projects to Web Mercator like slippy-map tiles', () => {
    // Sydney Opera House is in tile z15 x=30147 y=19662 (y counted from the north).
    expect(Math.floor(mercX(151.2153) * 2 ** 15)).toBe(30147);
    expect(Math.floor((1 - mercY(-33.8568)) * 2 ** 15)).toBe(19662);
  });

  it('sizes the off-screen map to the area so it fills the texture', () => {
    const wide = viewSize([151.195, -33.905, 151.29, -33.85], 640);
    expect(wide.width).toBe(640);
    const aspect = (mercX(151.29) - mercX(151.195)) / (mercY(-33.85) - mercY(-33.905));
    expect(wide.width / wide.height).toBeCloseTo(aspect, 1);
    expect(viewSize([151.2, -33.95, 151.21, -33.8], 640)).toEqual({ width: 64, height: 640 });
  });
});

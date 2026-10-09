import { describe, expect, it } from 'vitest';
import { chooseZoom, latToPx, lonToPx } from '../src/view3d/imagery.js';

describe('satellite imagery tiling', () => {
  it('matches standard slippy-map tile numbering', () => {
    // Sydney Opera House is in tile z15 x=30147 y=19662.
    expect(Math.floor(lonToPx(151.2153, 15) / 256)).toBe(30147);
    expect(Math.floor(latToPx(-33.8568, 15) / 256)).toBe(19662);
  });

  it('picks the sharpest zoom that fits the texture and tile budget', () => {
    const bbox = [151.205, -33.895, 151.29, -33.85]; // City2Surf with padding
    const plan = chooseZoom(bbox, { maxPx: 4096, maxTiles: 80 });
    expect(plan.nx * 256).toBeLessThanOrEqual(4096);
    expect(plan.nx * plan.ny).toBeLessThanOrEqual(80);
    const finer = chooseZoom(bbox, { maxPx: 4096, maxTiles: 80, maxZoom: plan.z + 1 });
    expect(finer.z).toBe(plan.z); // z+1 must not fit
    expect(plan.z).toBeGreaterThanOrEqual(14);
  });

  it('uses high zoom for a small area', () => {
    expect(chooseZoom([151.27, -33.892, 151.28, -33.888]).z).toBeGreaterThanOrEqual(17);
  });
});

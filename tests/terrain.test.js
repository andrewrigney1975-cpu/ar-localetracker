import { describe, expect, it } from 'vitest';
import { TERRAIN, chooseZoom, decodeTerrarium, latToPx, lonToPx, metresPerPixel, shadeRelief } from '../src/view3d/terrain.js';

const COLORS = { shadow: [0, 0, 0], light: [200, 200, 200], water: [0, 0, 255], none: [9, 9, 9] };

describe('terrain tiling', () => {
  it('matches standard slippy-map tile numbering', () => {
    // Sydney Opera House is in tile z15 x=30147 y=19662.
    expect(Math.floor(lonToPx(151.2153, 15) / 256)).toBe(30147);
    expect(Math.floor(latToPx(-33.8568, 15) / 256)).toBe(19662);
  });

  it('picks the sharpest zoom that fits the texture and tile budget', () => {
    const bbox = [151.205, -33.895, 151.29, -33.85]; // City2Surf with padding
    const plan = chooseZoom(bbox, { maxPx: 4096, maxTiles: 80, maxZoom: 18 });
    expect(plan.nx * 256).toBeLessThanOrEqual(4096);
    expect(plan.nx * plan.ny).toBeLessThanOrEqual(80);
    const finer = chooseZoom(bbox, { maxPx: 4096, maxTiles: 80, maxZoom: plan.z + 1 });
    expect(finer.z).toBe(plan.z); // z+1 must not fit
  });

  it('stops at the elevation data zoom for a small area', () => {
    expect(chooseZoom([151.27, -33.892, 151.28, -33.888]).z).toBe(TERRAIN.maxZoom);
  });

  it('knows the ground size of a pixel', () => {
    expect(metresPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metresPerPixel(60, 1)).toBeCloseTo(156543.03 / 4, 1);
  });
});

describe('shaded relief', () => {
  it('decodes Terrarium pixels to metres, missing tiles to NaN', () => {
    const e = decodeTerrarium(new Uint8ClampedArray([128, 0, 0, 255, 128, 100, 128, 255, 127, 246, 0, 255, 0, 0, 0, 0]), 4);
    expect(e[0]).toBe(0);
    expect(e[1]).toBeCloseTo(100.5, 5);
    expect(e[2]).toBe(-10);
    expect(e[3]).toBeNaN();
  });

  it('lights slopes facing the north-west sun and darkens those facing away', () => {
    const w = 5;
    // Ground rising to the east (x), 10 m per 10 m cell, faces west; the mirror faces east.
    const facingWest = Float32Array.from({ length: w * w }, (_, i) => 100 + (i % w) * 10);
    const facingEast = Float32Array.from({ length: w * w }, (_, i) => 200 - (i % w) * 10);
    const flat = new Float32Array(w * w).fill(100);
    const centre = (rgba) => rgba[(2 * w + 2) * 4];
    const lit = centre(shadeRelief(facingWest, w, w, 10, COLORS));
    const level = centre(shadeRelief(flat, w, w, 10, COLORS));
    const dark = centre(shadeRelief(facingEast, w, w, 10, COLORS));
    expect(lit).toBeGreaterThan(level);
    expect(level).toBeGreaterThan(dark);
    expect(level).toBe(Math.round(200 * Math.cos(Math.PI / 4)));
  });

  it('draws the sea flat (including the ±1 m ringing near the coast) and unknown cells neutral', () => {
    const out = shadeRelief(Float32Array.from([-5, 1.2, NaN, 12]), 2, 2, 10, COLORS);
    expect([...out.slice(0, 4)]).toEqual([0, 0, 255, 255]);
    expect([...out.slice(4, 8)]).toEqual([0, 0, 255, 255]);
    expect([...out.slice(8, 12)]).toEqual([9, 9, 9, 255]);
    expect(out[15]).toBe(255);
  });
});

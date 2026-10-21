import { describe, expect, it } from 'vitest';
import { clipRect, screenshotName } from '../src/services/screenshot.js';

describe('screenshot helpers', () => {
  it('keeps the part of an element inside every clip', () => {
    const screen = { left: 0, top: 0, right: 390, bottom: 844 };
    const body = { left: 0, top: 56, right: 390, bottom: 844 }; // scroller under the top bar
    // Scrolled so the element starts under the top bar and runs off the bottom.
    expect(clipRect({ left: 16, top: -100, right: 374, bottom: 1200 }, [screen, body])).toEqual({ x: 16, y: 56, width: 358, height: 788 });
    expect(clipRect({ left: 0, top: 900, right: 390, bottom: 1000 }, [screen])).toBeNull();
  });

  it('names screenshots by what and when', () => {
    expect(screenshotName('location', new Date(2026, 9, 21, 8, 5))).toBe('locale-location-20261021-0805.png');
  });
});

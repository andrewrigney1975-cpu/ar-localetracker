import { describe, expect, it } from 'vitest';
import { fitTabs } from '../src/ui/tabFit.js';

describe('fitTabs', () => {
  it('shows every tab when they fit', () => {
    expect(fitTabs(5, 374, 64, 3)).toEqual({ shown: [0, 1, 2, 3, 4], more: false });
  });

  it('moves tabs from the right into the menu, keeping a column for it', () => {
    expect(fitTabs(5, 244, 64, 0)).toEqual({ shown: [0, 1], more: true });
  });

  it('keeps the current tab on the bar in place of the last one that fits', () => {
    expect(fitTabs(5, 244, 64, 4)).toEqual({ shown: [0, 4], more: true });
    expect(fitTabs(5, 244, 64, 1)).toEqual({ shown: [0, 1], more: true });
  });

  it('always shows at least one tab', () => {
    expect(fitTabs(5, 100, 64, 3)).toEqual({ shown: [3], more: true });
  });

  it('uses the widest label when it needs more than the minimum', () => {
    expect(fitTabs(5, 374, 120, 2)).toEqual({ shown: [0, 2], more: true });
  });
});

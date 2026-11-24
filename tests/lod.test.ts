import { describe, expect, it } from 'vitest';
import {
  COLLAPSE_PX, DISPOSE_PX, EXPAND_PX, distanceInViews, fitView, intersects, screenSize, shouldDispose, stepAlpha,
  wantExpanded,
} from '../src/render/lod';

const view = { left: 0, right: 10, bottom: 0, top: 10 };

describe('LOD rules', () => {
  it('expands above EXPAND_PX and collapses below COLLAPSE_PX (hysteresis)', () => {
    expect(wantExpanded(false, EXPAND_PX - 1, true)).toBe(false);
    expect(wantExpanded(false, EXPAND_PX + 1, true)).toBe(true);
    expect(wantExpanded(true, (EXPAND_PX + COLLAPSE_PX) / 2, true)).toBe(true);
    expect(wantExpanded(false, (EXPAND_PX + COLLAPSE_PX) / 2, true)).toBe(false);
    expect(wantExpanded(true, COLLAPSE_PX - 1, true)).toBe(false);
    expect(wantExpanded(false, 10_000, false)).toBe(false);
  });

  it('crossfades over FADE_SEC, or instantly with fadeSec 0', () => {
    let a = 0;
    for (let i = 0; i < 3; i++) a = stepAlpha(a, 1, 0.1, 0.3);
    expect(a).toBeCloseTo(1);
    expect(stepAlpha(0.5, 0, 0.1, 0.3)).toBeCloseTo(0.5 - 1 / 3);
    expect(stepAlpha(0.9, 1, 1, 0.3)).toBe(1);
    expect(stepAlpha(0.3, 0, 0.01, 0)).toBe(0);
  });

  it('disposes only collapsed contents that are small or far away', () => {
    const near = [1, 1, 2, 2] as const;
    const far = [40, 40, 41, 41] as const;
    expect(shouldDispose(0, DISPOSE_PX - 1, near, view)).toBe(true);
    expect(shouldDispose(0, DISPOSE_PX + 50, near, view)).toBe(false);
    expect(shouldDispose(0, DISPOSE_PX + 50, far, view)).toBe(true);
    expect(shouldDispose(0.2, 1, far, view)).toBe(false);
  });

  it('measures the larger on-screen side', () => {
    expect(screenSize([0, 0, 3, 2], 10)).toBe(30);
    expect(screenSize([0, 0, 1, 4], 10)).toBe(40);
  });

  it('culls by intersection with the view', () => {
    expect(intersects([9, 9, 12, 12], view)).toBe(true);
    expect(intersects([11, 0, 12, 1], view)).toBe(false);
    expect(distanceInViews([20, 0, 21, 1], view)).toBeCloseTo(1);
  });

  it('fits a component with a margin for the canvas aspect', () => {
    expect(fitView([0, 0, 4, 2], 1, 1)).toEqual({ cx: 2, cy: 1, height: 4 });
    expect(fitView([0, 0, 4, 2], 4, 1)).toEqual({ cx: 2, cy: 1, height: 2 });
  });
});

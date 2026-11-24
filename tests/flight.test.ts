import { describe, expect, it } from 'vitest';
import { flightDuration, flightView } from '../src/ui/flight';

const ASPECT = 1.45;
/** Is the point inside the view (with a canvas of ASPECT)? */
const onScreen = (v: { cx: number; cy: number; height: number }, x: number, y: number) =>
  Math.abs(v.cx - x) <= (v.height * ASPECT) / 2 && Math.abs(v.cy - y) <= v.height / 2;

describe('camera flight', () => {
  it('starts and ends exactly at the two views', () => {
    const a = { cx: 0, cy: 0, height: 24 };
    const b = { cx: 3, cy: -2, height: 0.01 };
    const start = flightView(a, b, 0);
    expect(start.cx).toBeCloseTo(0);
    expect(start.cy).toBeCloseTo(0);
    expect(start.height).toBeCloseTo(24);
    const end = flightView(a, b, 1);
    expect(end.cx).toBeCloseTo(3);
    expect(end.cy).toBeCloseTo(-2);
    expect(end.height).toBeCloseTo(0.01);
  });

  it('keeps the target on screen during a deep zoom in, and the start on screen zooming out', () => {
    const home = { cx: 0, cy: 0, height: 30 };
    const deep = { cx: 6.3, cy: -9.1, height: 0.004 };
    for (let t = 0; t <= 1; t += 0.01) {
      expect(onScreen(flightView(home, deep, t), deep.cx, deep.cy), `in t=${t}`).toBe(true);
      expect(onScreen(flightView(deep, home, t), deep.cx, deep.cy) || flightView(deep, home, t).height > 1, `out t=${t}`).toBe(true);
    }
  });

  it('pans linearly when the zoom barely changes', () => {
    const v = flightView({ cx: 0, cy: 0, height: 10 }, { cx: 10, cy: 0, height: 10 }, 0.5);
    expect(v.cx).toBeCloseTo(5);
    expect(v.height).toBeCloseTo(10);
  });
});

describe('flight duration', () => {
  it('grows with the zoom distance, within limits', () => {

    expect(flightDuration(10, 10)).toBeCloseTo(0.6);
    expect(flightDuration(10, 2.5)).toBeGreaterThan(0.6);
    expect(flightDuration(30, 0.001)).toBe(2);
  });
});

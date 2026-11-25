import { describe, expect, it } from 'vitest';
import {
  CALCULATOR_SPEED, DEFAULT_SPEED, RATE_MAX, RATE_MIN, SLOWMO_MAX_MS, SLOWMO_MIN_MS, SPEED_MAX,
  isInstant, speedLabel, speedToMs, speedToRate,
} from '../src/ui/speed';

describe('speed slider', () => {
  it('runs from slowest (left) to instant (right end)', () => {
    expect(speedToMs(0)).toBe(SLOWMO_MAX_MS);
    expect(speedToMs(SPEED_MAX - 1)).toBe(SLOWMO_MIN_MS);
    expect(speedToMs(SPEED_MAX)).toBe(0);
    expect(isInstant(SPEED_MAX)).toBe(true);
    expect(isInstant(SPEED_MAX - 1)).toBe(false);
    for (let v = 1; v < SPEED_MAX; v++) expect(speedToMs(v)).toBeLessThanOrEqual(speedToMs(v - 1));
  });
  it('speeds the clock up with the animation', () => {
    expect(speedToRate(0)).toBe(RATE_MIN);
    expect(speedToRate(SPEED_MAX - 1)).toBe(RATE_MAX);
    expect(speedToRate(SPEED_MAX)).toBe(RATE_MAX);
    for (let v = 1; v <= SPEED_MAX; v++) expect(speedToRate(v)).toBeGreaterThanOrEqual(speedToRate(v - 1));
  });
  it('labels and defaults', () => {
    expect(speedLabel(SPEED_MAX)).toBe('instant');
    expect(speedLabel(0)).toBe('1000 ms / step');
    expect(speedToMs(DEFAULT_SPEED)).toBeGreaterThan(150);
    expect(speedToMs(DEFAULT_SPEED)).toBeLessThan(260);
    expect(speedToMs(CALCULATOR_SPEED)).toBeGreaterThan(20);
    expect(speedToMs(CALCULATOR_SPEED)).toBeLessThan(40);
  });
});

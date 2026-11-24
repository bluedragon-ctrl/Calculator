import { describe, expect, it } from 'vitest';
import { msLabel, sliderToMs, SLOWMO_MAX_MS, SLOWMO_MIN_MS } from '../src/ui/slowmo';

describe('slow-motion slider', () => {
  it('maps 0 to instant and 1..100 to 20..1000 ms, increasing', () => {
    expect(sliderToMs(0)).toBe(0);
    expect(sliderToMs(1)).toBe(SLOWMO_MIN_MS);
    expect(sliderToMs(100)).toBe(SLOWMO_MAX_MS);
    for (let v = 2; v <= 100; v++) expect(sliderToMs(v)).toBeGreaterThanOrEqual(sliderToMs(v - 1));
    expect(msLabel(0)).toBe('instant');
    expect(msLabel(250)).toBe('250 ms / step');
  });
});

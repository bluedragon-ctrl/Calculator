import { describe, expect, it } from 'vitest';
import { CLOCK_RATES, ClockRunner, rateFromSlider, rateLabel } from '../src/ui/clock';

describe('clock bar logic', () => {
  it('maps the speed slider to 0.25–4 ticks per second', () => {
    expect(CLOCK_RATES[0]).toBe(0.25);
    expect(CLOCK_RATES.at(-1)).toBe(4);
    expect(rateFromSlider(-3)).toBe(0.25);
    expect(rateFromSlider(2)).toBe(1);
    expect(rateFromSlider(99)).toBe(4);
    expect(rateLabel(1)).toBe('1 tick/s');
    expect(rateLabel(0.25)).toBe('0.25 ticks/s');
  });

  it('pause and instant never tick by themselves', () => {
    const c = new ClockRunner();
    expect(c.update(10_000, false)).toBe(false);
    c.setMode('instant');
    expect(c.update(10_000, false)).toBe(false);
  });

  it('play ticks at once, then once per period', () => {
    const c = new ClockRunner();
    c.ticksPerSec = 2;
    c.setMode('play');
    expect(c.update(16, false)).toBe(true);
    let ticks = 0;
    for (let t = 0; t < 2000; t += 10) if (c.update(10, false)) ticks++;
    expect(ticks).toBe(4);
  });

  it('play waits while the last tick is still being animated', () => {
    const c = new ClockRunner();
    c.ticksPerSec = 4;
    c.setMode('play');
    expect(c.update(1, true)).toBe(false);
    expect(c.update(5000, true)).toBe(false);
    expect(c.update(1, false)).toBe(true);
  });
});

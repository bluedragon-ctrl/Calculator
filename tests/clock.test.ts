import { describe, expect, it } from 'vitest';
import { ClockRunner } from '../src/ui/clock';

describe('clock bar logic', () => {
  it('starts in Run: with a control unit it ticks only while there is work', () => {
    const c = new ClockRunner();
    expect(c.mode).toBe('run');
    c.ticksPerSec = 2;
    expect(c.update(10_000, false, false)).toBe(false);
    expect(c.update(1, false, true)).toBe(true); // work arrives: tick at once
    expect(c.update(100, false, true)).toBe(false);
    expect(c.update(400, false, true)).toBe(true);
    expect(c.update(400, true, true)).toBe(false); // waits for the animation
    expect(c.update(10_000, false, false)).toBe(false); // back in IDLE: stops
    expect(c.update(1, false, true)).toBe(true);
  });

  it('pause never ticks by itself', () => {
    const c = new ClockRunner();
    c.setMode('pause');
    expect(c.update(10_000, false)).toBe(false);
    expect(c.update(10_000, false, true)).toBe(false);
  });

  it('without a control unit, run ticks at once, then once per period', () => {
    const c = new ClockRunner();
    c.ticksPerSec = 2;
    c.setMode('pause');
    c.setMode('run');
    expect(c.update(16, false)).toBe(true);
    let ticks = 0;
    for (let t = 0; t < 2000; t += 10) if (c.update(10, false)) ticks++;
    expect(ticks).toBe(4);
  });

  it('run waits while the last tick is still being animated', () => {
    const c = new ClockRunner();
    c.ticksPerSec = 4;
    expect(c.update(1, true)).toBe(false);
    expect(c.update(5000, true)).toBe(false);
    expect(c.update(1, false)).toBe(true);
  });
});

// Clock modes (DESIGN.md §6.5). Pure logic, no DOM: decides when Play makes the next tick.
//   pause   – the clock stands still; Step makes one tick.
//   play    – ticks at 0.25–4 per second, but never before the last tick has finished playing.
//   instant – no animation: every tick and input change shows its result at once.
// "Auto" (run while the control unit is busy) comes with the control unit in Phase 4.

export type ClockMode = 'pause' | 'play' | 'instant';

/** Play speeds in ticks per second; the slider picks one by index. */
export const CLOCK_RATES = [0.25, 0.5, 1, 2, 4] as const;
export const DEFAULT_RATE_INDEX = 2;

export function rateFromSlider(v: number): number {
  const i = Math.min(Math.max(Math.round(v), 0), CLOCK_RATES.length - 1);
  return CLOCK_RATES[i];
}

export function rateLabel(rate: number): string {
  return rate === 1 ? '1 tick/s' : `${rate} ticks/s`;
}

export class ClockRunner {
  private mode_: ClockMode = 'pause';
  ticksPerSec: number = CLOCK_RATES[DEFAULT_RATE_INDEX];
  /** Milliseconds since the last tick of Play. */
  private since = 0;

  get mode(): ClockMode {
    return this.mode_;
  }

  setMode(m: ClockMode): void {
    if (m === this.mode_) return;
    this.mode_ = m;
    // Pressing Play ticks at once rather than after a full period.
    this.since = Infinity;
  }

  /**
   * Advance time. Returns true when Play should tick now. `busy` = the last tick's animation
   * is still playing: the clock waits for it, so slow motion also slows the clock down.
   */
  update(dtMs: number, busy: boolean): boolean {
    if (this.mode_ !== 'play') return false;
    this.since += dtMs;
    if (busy || this.since < 1000 / this.ticksPerSec) return false;
    this.since = 0;
    return true;
  }
}

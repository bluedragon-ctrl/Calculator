// Clock modes (DESIGN.md §6.5). Pure logic, no DOM: decides when Run makes the next tick.
//   pause – the clock stands still; Step makes one tick.
//   run   – (default) ticks at `ticksPerSec`, but never before the last tick has finished
//           playing. With a control unit (the calculator) it only runs while there is work
//           to do and stops by itself in IDLE; without one (a bench) it runs freely.
// How fast the animation plays, including "instant", is set by the speed slider (speed.ts).

export type ClockMode = 'pause' | 'run';

export class ClockRunner {
  private mode_: ClockMode = 'run';
  ticksPerSec = 1;
  /** Milliseconds since the last tick of Run. */
  private since = Infinity;

  get mode(): ClockMode {
    return this.mode_;
  }

  setMode(m: ClockMode): void {
    if (m === this.mode_) return;
    this.mode_ = m;
    // Pressing Run ticks at once rather than after a full period.
    this.since = Infinity;
  }

  /**
   * Advance time. Returns true when Run should tick now. `busy` = the last tick's animation
   * is still playing: the clock waits for it, so slow motion also slows the clock down.
   * `work` = the control unit has work to do; leave it out when there is no control unit.
   */
  update(dtMs: number, busy: boolean, work?: boolean): boolean {
    if (this.mode_ !== 'run') return false;
    if (work === false) {
      // Idle: the next key press starts the clock at once.
      this.since = Infinity;
      return false;
    }
    this.since += dtMs;
    if (busy || this.since < 1000 / this.ticksPerSec) return false;
    this.since = 0;
    return true;
  }
}

// Plays a simulation timeline back in slowed-down time (DESIGN.md §6.5).
// No three.js here: it only tracks which nets are mid-change, so it is unit-testable.
import type { Bit } from '../sim/types';
import type { Timeline } from '../sim/simulator';

export interface Transition {
  from: Bit;
  to: Bit;
  /** 0..1: how far the change has travelled along the wire. */
  progress: number;
}

interface Scheduled {
  net: number;
  value: Bit;
  /** Start time in delta steps (playback clock). */
  start: number;
}

export class Playback {
  /** Milliseconds per delta step. 0 = instant. */
  msPerDelta = 250;
  /** Playback clock in delta steps. */
  private time = 0;
  /** End of everything queued so far. */
  private end = 0;
  private readonly shown: Uint8Array;
  private pending: Scheduled[] = [];
  private readonly active = new Map<number, { from: Bit; to: Bit; start: number }>();
  /** Called when a net starts changing (for sparks) and when it finishes. */
  onStart: ((net: number, from: Bit, to: Bit) => void) | null = null;
  onSettle: ((net: number, value: Bit) => void) | null = null;

  constructor(initial: ArrayLike<number>) {
    this.shown = Uint8Array.from(initial);
  }

  /** Queue a timeline after anything already playing. */
  push(t: Timeline): void {
    const base = Math.max(this.time, this.end);
    for (const e of t.events) this.pending.push({ net: e.net, value: e.value, start: base + e.delta });
    if (t.events.length) this.end = Math.max(this.end, base + t.deltas + 1);
    if (this.msPerDelta <= 0) this.advance(Infinity);
  }

  get busy(): boolean {
    return this.pending.length > 0 || this.active.size > 0;
  }

  /** Displayed (settled) value: changes only once the change has reached the end of the wire. */
  value(net: number): Bit {
    return this.shown[net] as Bit;
  }

  transition(net: number): Transition | null {
    const a = this.active.get(net);
    if (!a) return null;
    return { from: a.from, to: a.to, progress: Math.min(Math.max(this.time - a.start, 0), 1) };
  }

  /** Nets currently changing. */
  changing(): IterableIterator<number> {
    return this.active.keys();
  }

  update(dtMs: number): void {
    this.advance(this.msPerDelta <= 0 ? Infinity : dtMs / this.msPerDelta);
  }

  /** Jump to the end of everything queued. */
  finish(): void {
    this.advance(Infinity);
  }

  private advance(deltas: number): void {
    const target = this.time + deltas;
    // Process in time order so a glitch (two changes on one net) plays both halves.
    for (;;) {
      const nextStart = this.pending.length ? this.pending[0].start : Infinity;
      let nextEnd = Infinity;
      for (const a of this.active.values()) nextEnd = Math.min(nextEnd, a.start + 1);
      const next = Math.min(nextStart, nextEnd);
      if (next > target || next === Infinity) break;
      this.time = Math.max(this.time, next);
      if (nextEnd <= nextStart) {
        for (const [net, a] of [...this.active]) {
          if (a.start + 1 <= this.time) this.settle(net, a.to);
        }
      } else {
        const e = this.pending.shift()!;
        const cur = this.active.get(e.net);
        if (cur) this.settle(e.net, cur.to);
        const from = this.shown[e.net] as Bit;
        if (from !== e.value) {
          this.active.set(e.net, { from, to: e.value, start: e.start });
          this.onStart?.(e.net, from, e.value);
        }
      }
    }
    if (target === Infinity) {
      this.time = Math.max(this.time, this.end);
    } else {
      this.time = target;
    }
    if (!this.busy) {
      // Idle: keep the clock from running ahead of new timelines.
      this.end = this.time;
    }
  }

  private settle(net: number, v: Bit): void {
    this.active.delete(net);
    this.shown[net] = v;
    this.onSettle?.(net, v);
  }
}

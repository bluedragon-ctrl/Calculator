// Headless driver for the whole calculator (DESIGN.md §4.4): drives key lines, queues keys
// that arrive while the control unit is busy, ticks the clock, and reads registers and the
// display. Pure TypeScript (no rendering), so scenarios run in tests.
import { bitsToNumber } from '../sim/bus';
import { flatten, pinKey, type Circuit } from '../sim/flatten';
import type { Library } from '../sim/library';
import { CLOCK_HIGH_DELTAS, Simulator, type Timeline } from '../sim/simulator';
import type { Bit } from '../sim/types';
import { STATES, type State } from './control';
import { SEGMENTS } from './display';
import { CODE_BLANK } from './gen/displayRom';
import { SEGMENT_PINS } from './calculator';

/** Key codes (DESIGN.md §3.1). */
export const KEY = { PLUS: 10, MINUS: 11, EQ: 12, C: 13, M: 14, MR: 15 } as const;

/** Label shown on each key. */
export const KEY_LABELS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '−', '=', 'C', 'M', 'MR'];

/** Physical keyboard → key code (DESIGN.md §3.1). */
export function keyCodeFor(key: string): number | null {
  if (/^[0-9]$/.test(key)) return Number(key);
  switch (key) {
    case '+': return KEY.PLUS;
    case '-': return KEY.MINUS;
    case '=': case 'Enter': return KEY.EQ;
    case 'Escape': case 'Delete': return KEY.C;
    case 'm': case 'M': return KEY.M;
    case 'r': case 'R': return KEY.MR;
    default: return null;
  }
}

/** Characters of the 4 display positions for each segment pattern. */
const PATTERN_CHAR = new Map<string, string>();
for (const [code, segs] of Object.entries(SEGMENTS)) {
  if (Number(code) >= CODE_BLANK) continue;
  PATTERN_CHAR.set(segs, Number(code) <= 9 ? code : Number(code) === 10 ? 'E' : 'r');
}
PATTERN_CHAR.set('', ' ');

/** Text of one digit position from its 7 segment bits (a…g). */
export function segmentChar(bits: readonly Bit[]): string {
  const segs = 'abcdefg'.split('').filter((_, i) => bits[i]).join('');
  return PATTERN_CHAR.get(segs) ?? '?';
}

/** Concatenate timelines, each starting after the previous one has finished. */
export function joinTimelines(parts: Timeline[]): Timeline {
  const events: Timeline['events'] = [];
  let offset = 0;
  let oscillating = false;
  for (const t of parts) {
    if (!t.events.length) continue;
    for (const e of t.events) events.push({ ...e, delta: e.delta + offset });
    offset += t.deltas + CLOCK_HIGH_DELTAS;
    oscillating ||= t.oscillating;
  }
  return { events, deltas: events.length ? events[events.length - 1].delta : 0, oscillating };
}

export class Machine {
  readonly circuit: Circuit;
  readonly sim: Simulator;
  /** Keys pressed while the calculator was busy (UI only, not hardware: DESIGN.md §4.4). */
  readonly queue: number[] = [];
  /** Key line currently held high, waiting for the next clock edge. */
  held: number | null = null;
  /** Ticks since power-on. */
  ticks = 0;

  constructor(readonly lib: Library) {
    this.circuit = flatten(lib.get('Calculator'), lib);
    this.sim = new Simulator(this.circuit);
  }

  /** Net of a pin anywhere in the hierarchy, e.g. `'xreg.q3'`. */
  net(path: string): number {
    const n = this.circuit.pinNet.get(path);
    if (n === undefined) throw new Error(`No net "${path}"`);
    return n;
  }

  bit(path: string): Bit {
    return this.sim.get(this.net(path));
  }

  private bus(prefix: string, width: number, signed: boolean): number {
    return bitsToNumber(Array.from({ length: width }, (_, i) => this.bit(`${prefix}${i}`)), signed);
  }

  get x(): number { return this.bus('xreg.q', 8, true); }
  get y(): number { return this.bus('yreg.q', 8, true); }
  get m(): number { return this.bus('mreg.q', 8, true); }
  get key(): number { return this.bus('keyreg.key', 4, false); }
  get ready(): Bit { return this.bit('keyreg.ready'); }
  get op(): Bit { return this.bit('flags.op'); }
  get pend(): Bit { return this.bit('flags.pend'); }
  get e(): Bit { return this.bit('flags.e'); }
  get stateCode(): number { return this.bus(pinKey('ctrl', 'pla.s'), 4, false); }
  get state(): State | '?' { return STATES[this.stateCode] ?? '?'; }
  get mIndicator(): Bit { return this.sim.output('mInd'); }

  /** The 4 display positions as text, e.g. `"  -27"` → `" -27"` (sign, hundreds, tens, ones). */
  get display(): string {
    const sign = this.sim.output('sg') ? '-' : ' ';
    const digit = (d: string) => segmentChar('abcdefg'.split('').map((s) => this.sim.output(`${d}${s}`)));
    return sign + digit('h') + digit('t') + digit('o');
  }

  /** Segment outputs by pin name (for the device and HUD displays). */
  segments(): Record<string, Bit> {
    return Object.fromEntries(SEGMENT_PINS.map((p) => [p, this.sim.output(p)]));
  }

  /** The control unit has work to do (a key is waiting, or it is not back in IDLE). */
  get working(): boolean {
    return this.held !== null || this.ready === 1 || this.stateCode !== 0;
  }

  /** Clock mode Auto runs while this is true (DESIGN.md §6.5). */
  get busy(): boolean {
    return this.working || this.queue.length > 0;
  }

  /**
   * A key is pressed. If the calculator is free, its line goes high now (the encoder reacts at
   * once); otherwise the key waits in the queue. Returns the timeline of the line going high.
   */
  press(code: number): Timeline | null {
    if (code < 0 || code > 15) throw new Error(`Bad key code ${code}`);
    if (this.working || this.queue.length) {
      this.queue.push(code);
      return null;
    }
    return this.driveLine(code);
  }

  private driveLine(code: number): Timeline {
    this.held = code;
    this.sim.setInput(`k${code}`, 1);
    return this.sim.settle();
  }

  /**
   * One clock tick. A held key line is captured by the KEY register at the edge and released
   * after it; once the calculator is free again, the next queued key's line goes high.
   */
  tick(): Timeline {
    const parts = [this.sim.tick()];
    this.ticks++;
    if (this.held !== null) {
      this.sim.setInput(`k${this.held}`, 0);
      this.held = null;
      parts.push(this.sim.settle());
    }
    if (!this.working && this.queue.length) parts.push(this.driveLine(this.queue.shift()!));
    return joinTimelines(parts);
  }

  /** Tick until the calculator is free (for Instant mode and tests). Returns the ticks used. */
  runUntilIdle(limit = 1000): number {
    let n = 0;
    while (this.busy) {
      if (n++ >= limit) throw new Error('Calculator never became idle');
      this.tick();
    }
    return n;
  }

  /** Type keys (as on the physical keyboard, e.g. `"7+9="`, `"C"` = clear, `"m"`, `"r"`) and run until idle. */
  type(keys: string): void {
    for (const ch of keys) {
      const code = ch === 'C' ? 13 : keyCodeFor(ch);
      if (code === null) throw new Error(`No key for "${ch}"`);
      this.press(code);
      this.runUntilIdle();
    }
  }
}

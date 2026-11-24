// Event-driven, unit-delay simulator producing a timeline (DESIGN.md §5.1, §5.3).
import type { Circuit, Gate } from './flatten';
import { inputPins } from './library';
import type { Bit } from './types';

export interface NetEvent {
  net: number;
  value: Bit;
  /** Delta step at which the net takes the new value. */
  delta: number;
}

export interface Timeline {
  /** Net changes in delta order (ties keep scheduling order, so the timeline is deterministic). */
  events: NetEvent[];
  /** Delta of the last change (0 if nothing changed). */
  deltas: number;
  /** True when the safety limit stopped the run. */
  oscillating: boolean;
}

export const DELTA_LIMIT = 10_000;

/** Name of the top-level clock input driven by `tick()`. */
export const CLOCK_PIN = 'clk';

/** The clock stays high this many delta steps after the rising edge's last change. */
export const CLOCK_HIGH_DELTAS = 2;

interface ClockedLeaf {
  gate: Gate;
  /** Index of the D input in the gate's inputs. */
  d: number;
}

export class Simulator {
  private readonly values: Uint8Array;
  /** Value each net will have once everything already scheduled has happened. */
  private readonly projected: Uint8Array;
  private readonly queue = new Map<number, Map<number, Bit>>();
  private readonly scratch: Bit[][];
  /** Stored bit per gate (only clocked leaves use it). */
  private readonly state: Uint8Array;
  private readonly clocked: ClockedLeaf[];
  /** What happened at power-on (not shown to students; tests check it settles). */
  readonly startup: Timeline;

  constructor(readonly circuit: Circuit) {
    this.values = new Uint8Array(circuit.netCount);
    this.projected = new Uint8Array(circuit.netCount);
    this.state = new Uint8Array(circuit.gates.length);
    this.scratch = circuit.gates.map((g) => new Array<Bit>(g.inputs.length).fill(0));
    this.clocked = circuit.gates
      .filter((g) => g.behavior.clocked)
      .map((gate) => ({ gate, d: inputPins(gate.def).indexOf(gate.behavior.clocked!.d) }));
    // Power on: every net starts at 0 except the defined reset values of latches (Q = 0),
    // every flip-flop stores 0, then all gates evaluate once and the circuit settles.
    for (const [net, v] of circuit.powerOn) this.values[net] = this.projected[net] = v;
    this.startup = this.run(circuit.gates.map((g) => g.id));
  }

  /** Stored bit of a clocked leaf (a behavioural flip-flop), by gate id. */
  stored(gate: number): Bit {
    return this.state[gate] as Bit;
  }

  get hasClock(): boolean {
    return this.circuit.inputs[CLOCK_PIN] !== undefined || this.clocked.length > 0;
  }

  /**
   * One clock tick (DESIGN.md §5.3): sample D of every behavioural flip-flop before the edge,
   * apply the rising edge (Q changes at delta 0, together with the clock input `clk`), settle,
   * then let the clock fall again and settle. Structural flip-flops react to `clk` itself.
   * Returns one timeline: the falling half starts CLOCK_HIGH_DELTAS after the rising half ends.
   */
  tick(): Timeline {
    const clk = this.circuit.inputs[CLOCK_PIN];
    const samples = this.clocked.map(({ gate, d }) => this.values[gate.inputs[d]] as Bit);
    if (clk !== undefined) this.schedule(clk, 1, 0);
    this.clocked.forEach(({ gate }, i) => {
      this.state[gate.id] = samples[i];
      const outs = gate.behavior.eval(this.readInputs(gate), samples[i]);
      gate.outputs.forEach((net, k) => this.schedule(net, outs[k], 0));
    });
    const rise = this.run([]);
    if (clk === undefined || rise.oscillating) return rise;
    this.schedule(clk, 0, 0);
    const fall = this.run([]);
    const offset = rise.events.length ? rise.deltas + CLOCK_HIGH_DELTAS : 0;
    return {
      events: [...rise.events, ...fall.events.map((e) => ({ ...e, delta: e.delta + offset }))],
      deltas: fall.events.length ? fall.deltas + offset : rise.deltas,
      oscillating: fall.oscillating,
    };
  }

  get(net: number): Bit {
    return this.values[net] as Bit;
  }

  input(name: string): Bit {
    return this.get(this.netOfInput(name));
  }

  output(name: string): Bit {
    const net = this.circuit.outputs[name];
    if (net === undefined) throw new Error(`Unknown output "${name}"`);
    return this.get(net);
  }

  /** Drive a top-level input. Takes effect at delta 0 of the next `settle()`. */
  setInput(name: string, v: Bit): void {
    this.schedule(this.netOfInput(name), v, 0);
  }

  /** Apply pending input changes and run until the circuit is stable. */
  settle(): Timeline {
    return this.run([]);
  }

  /** Convenience for tests: set several inputs, settle, return all outputs. */
  apply(inputs: Record<string, Bit>): Record<string, Bit> {
    for (const [k, v] of Object.entries(inputs)) this.setInput(k, v);
    this.settle();
    const out: Record<string, Bit> = {};
    for (const k of Object.keys(this.circuit.outputs)) out[k] = this.output(k);
    return out;
  }

  private netOfInput(name: string): number {
    const net = this.circuit.inputs[name];
    if (net === undefined) throw new Error(`Unknown input "${name}"`);
    return net;
  }

  private schedule(net: number, v: Bit, at: number): void {
    if (this.projected[net] === v) return;
    this.projected[net] = v;
    let slot = this.queue.get(at);
    if (!slot) {
      slot = new Map();
      this.queue.set(at, slot);
    }
    slot.delete(net); // keep insertion order = latest scheduling order
    slot.set(net, v);
  }

  private readInputs(g: Gate): Bit[] {
    const ins = this.scratch[g.id];
    for (let i = 0; i < g.inputs.length; i++) ins[i] = this.values[g.inputs[i]] as Bit;
    return ins;
  }

  private run(initialGates: number[]): Timeline {
    const { gates, fanout } = this.circuit;
    const events: NetEvent[] = [];
    let toEval = new Set<number>(initialGates);
    let t = 0;
    let last = 0;
    for (;;) {
      const slot = this.queue.get(t);
      if (slot) {
        this.queue.delete(t);
        for (const [net, v] of slot) {
          if (this.values[net] === v) continue;
          this.values[net] = v;
          events.push({ net, value: v, delta: t });
          last = t;
          for (const g of fanout[net]) toEval.add(g);
        }
      }
      if (toEval.size > 0) {
        const batch = toEval;
        toEval = new Set();
        for (const id of batch) {
          const g = gates[id];
          const outs = g.behavior.eval(this.readInputs(g), this.state[id] as Bit);
          for (let i = 0; i < g.outputs.length; i++) this.schedule(g.outputs[i], outs[i], t + g.behavior.delay);
        }
        if (this.queue.has(t)) continue; // zero-delay parts: settle this delta first
      }
      if (this.queue.size === 0) return { events, deltas: last, oscillating: false };
      t = Math.min(...this.queue.keys());
      if (t > DELTA_LIMIT) {
        this.queue.clear();
        this.projected.set(this.values);
        return { events, deltas: last, oscillating: true };
      }
    }
  }
}

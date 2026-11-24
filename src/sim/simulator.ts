// Event-driven, unit-delay simulator producing a timeline (DESIGN.md §5.1, §5.3).
import type { Circuit } from './flatten';
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

export class Simulator {
  private readonly values: Uint8Array;
  /** Value each net will have once everything already scheduled has happened. */
  private readonly projected: Uint8Array;
  private readonly queue = new Map<number, Map<number, Bit>>();
  private readonly scratch: Bit[][];

  constructor(readonly circuit: Circuit) {
    this.values = new Uint8Array(circuit.netCount);
    this.projected = new Uint8Array(circuit.netCount);
    this.scratch = circuit.gates.map((g) => new Array<Bit>(g.inputs.length).fill(0));
    // Power on: every net starts at 0, then all gates evaluate once and the circuit settles.
    this.run(circuit.gates.map((g) => g.id));
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
          const ins = this.scratch[id];
          for (let i = 0; i < g.inputs.length; i++) ins[i] = this.values[g.inputs[i]] as Bit;
          const outs = g.behavior.eval(ins);
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

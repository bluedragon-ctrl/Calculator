// Switch-level (transistor) evaluation of CMOS primitives (DESIGN.md §5.5, §10).
import type { Library } from './library';
import type { Bit, CmosDef, CmosNet, ComponentDef } from './types';

export const VDD = 'VDD';
export const GND = 'GND';
export const OUT = 'OUT';

export interface Transistor {
  id: number;
  type: 'p' | 'n';
  /** Input pin driving the gate. */
  input: string;
  /** Channel terminals (node names). `a` is the end nearer VDD. */
  a: string;
  b: string;
}

export interface CmosNetlist {
  transistors: Transistor[];
  /** All node names: VDD, OUT, GND and internal nodes between series transistors. */
  nodes: string[];
}

export function cmosNetlist(cmos: CmosDef): CmosNetlist {
  const transistors: Transistor[] = [];
  const nodes = [VDD, OUT, GND];
  const counters = { p: 0, n: 0 };
  const build = (net: CmosNet, top: string, bottom: string, type: 'p' | 'n') => {
    if (net.kind === 'fet') {
      transistors.push({ id: transistors.length, type, input: net.input, a: top, b: bottom });
    } else if (net.kind === 'parallel') {
      for (const p of net.parts) build(p, top, bottom, type);
    } else {
      let cur = top;
      net.parts.forEach((p, i) => {
        let next = bottom;
        if (i < net.parts.length - 1) {
          next = `${type}${++counters[type]}`;
          nodes.push(next);
        }
        build(p, cur, next, type);
        cur = next;
      });
    }
  };
  build(cmos.pullUp, VDD, OUT, cmos.upType ?? 'p');
  if (cmos.pullDown) build(cmos.pullDown, OUT, GND, 'n');
  return { transistors, nodes };
}

export type NodeLevel = 'vdd' | 'gnd' | 'float' | 'short';
export type TransistorFault = 'on' | 'off';

export interface SwitchResult {
  /** Output value, or 'float' (connected to nothing) / 'short' (connected to both rails). */
  out: Bit | 'float' | 'short';
  /** Conducting state per transistor id. */
  on: boolean[];
  level: Record<string, NodeLevel>;
  /** Conducting transistors that connect the output to a rail (the path current flows on). */
  path: number[];
}

export function evaluateSwitches(
  netlist: CmosNetlist,
  inputs: Record<string, Bit>,
  faults: Record<number, TransistorFault> = {},
): SwitchResult {
  const on = netlist.transistors.map((t) => {
    const f = faults[t.id];
    if (f) return f === 'on';
    const g = inputs[t.input];
    if (g === undefined) throw new Error(`Missing input "${t.input}"`);
    return t.type === 'p' ? g === 0 : g === 1;
  });
  const reach = (start: string): Set<string> => {
    const seen = new Set([start]);
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      for (const t of netlist.transistors) {
        if (!on[t.id]) continue;
        const other = t.a === n ? t.b : t.b === n ? t.a : null;
        if (other && !seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }
    return seen;
  };
  const fromVdd = reach(VDD);
  const fromGnd = reach(GND);
  const level: Record<string, NodeLevel> = {};
  for (const n of netlist.nodes) {
    const v = fromVdd.has(n);
    const g = fromGnd.has(n);
    level[n] = v && g ? 'short' : v ? 'vdd' : g ? 'gnd' : 'float';
  }
  const lo = level[OUT];
  const out = lo === 'vdd' ? 1 : lo === 'gnd' ? 0 : lo;
  // Every conducting transistor on some simple path from OUT to the rail it is connected to.
  const onPath = new Set<number>();
  if (lo === 'vdd' || lo === 'gnd') {
    const rail = lo === 'vdd' ? VDD : GND;
    const visited = new Set([OUT]);
    const used: number[] = [];
    const dfs = (n: string) => {
      if (n === rail) {
        for (const id of used) onPath.add(id);
        return;
      }
      for (const t of netlist.transistors) {
        if (!on[t.id]) continue;
        const other = t.a === n ? t.b : t.b === n ? t.a : null;
        if (!other || visited.has(other)) continue;
        visited.add(other);
        used.push(t.id);
        dfs(other);
        used.pop();
        visited.delete(other);
      }
    };
    dfs(OUT);
  }
  const path = [...onPath].sort((x, y) => x - y);
  return { out, on, level, path };
}

/** Transistor count from the structure (DESIGN.md §5.6). */
export function countTransistors(def: ComponentDef, lib: Library): number {
  if (def.cmos) return cmosNetlist(def.cmos).transistors.length;
  if (def.parts) {
    return Object.values(def.parts).reduce((n, p) => n + countTransistors(lib.get(p.type), lib), 0);
  }
  return 0; // table-driven leaves (ROM, PLA) have no transistor structure here
}

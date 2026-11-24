// Flatten a component hierarchy into primitive gates and nets (DESIGN.md §5.2).
import { inputPins, isLeaf, outputPins, splitRef, type Library } from './library';
import type { Behavior, ComponentDef } from './types';

export interface Gate {
  id: number;
  /** Instance path, e.g. `"x1.n2"`. */
  path: string;
  def: ComponentDef;
  behavior: Behavior;
  /** Net ids in the def's input/output pin order. */
  inputs: number[];
  outputs: number[];
}

export interface Instance {
  path: string;
  def: ComponentDef;
}

export interface Circuit {
  top: ComponentDef;
  netCount: number;
  /** A readable hierarchical name per net. */
  netNames: string[];
  gates: Gate[];
  /** Gates reading each net. */
  fanout: number[][];
  /** Driving gate per net, or -1 for a top-level input. */
  driver: number[];
  /** Top-level input pin → net. */
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  /** Every instance in the hierarchy by path (`''` is the top). */
  instances: Map<string, Instance>;
  /** Net id of any pin in the hierarchy, keyed by `pinKey(path, pin)`. */
  pinNet: Map<string, number>;
}

export function pinKey(path: string, pin: string): string {
  return path ? `${path}.${pin}` : pin;
}

class UnionFind {
  private parent: number[] = [];
  make(): number {
    this.parent.push(this.parent.length);
    return this.parent.length - 1;
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

interface RawGate {
  path: string;
  def: ComponentDef;
  inputs: number[];
  outputs: number[];
}

export function flatten(top: ComponentDef, lib: Library): Circuit {
  const uf = new UnionFind();
  const rawGates: RawGate[] = [];
  const instances = new Map<string, Instance>();
  const rawPins = new Map<string, number>();
  const names: [number, string][] = [];

  const visit = (def: ComponentDef, path: string, pins: Record<string, number>) => {
    instances.set(path, { path, def });
    for (const [p, id] of Object.entries(pins)) rawPins.set(pinKey(path, p), id);
    if (isLeaf(def)) {
      rawGates.push({
        path,
        def,
        inputs: inputPins(def).map((p) => pins[p]),
        outputs: outputPins(def).map((p) => pins[p]),
      });
      return;
    }
    const childPins: Record<string, Record<string, number>> = {};
    for (const [name, part] of Object.entries(def.parts ?? {})) {
      const cdef = lib.get(part.type);
      childPins[name] = {};
      for (const p of Object.keys(cdef.pins)) childPins[name][p] = uf.make();
    }
    const idOf = (ref: string) => {
      const { part, pin } = splitRef(ref);
      return part === null ? pins[pin] : childPins[part][pin];
    };
    for (const net of def.nets ?? []) {
      const d = idOf(net.from);
      for (const t of net.to) uf.union(d, idOf(t));
      names.push([d, pinKey(path, net.name ?? net.from)]);
    }
    for (const [name, part] of Object.entries(def.parts ?? {})) {
      visit(lib.get(part.type), pinKey(path, name), childPins[name]);
    }
  };

  const topPins: Record<string, number> = {};
  for (const p of Object.keys(top.pins)) topPins[p] = uf.make();
  visit(top, '', topPins);

  // Compress union-find roots into dense net ids.
  const dense = new Map<number, number>();
  const netOf = (raw: number) => {
    const r = uf.find(raw);
    let id = dense.get(r);
    if (id === undefined) {
      id = dense.size;
      dense.set(r, id);
    }
    return id;
  };

  const gates: Gate[] = rawGates.map((g, id) => ({
    id,
    path: g.path,
    def: g.def,
    behavior: g.def.behavior!,
    inputs: g.inputs.map(netOf),
    outputs: g.outputs.map(netOf),
  }));
  const inputs: Record<string, number> = {};
  const outputs: Record<string, number> = {};
  for (const p of inputPins(top)) inputs[p] = netOf(topPins[p]);
  for (const p of outputPins(top)) outputs[p] = netOf(topPins[p]);
  const pinNet = new Map<string, number>();
  for (const [k, raw] of rawPins) pinNet.set(k, netOf(raw));

  const netCount = dense.size;
  const netNames: string[] = new Array(netCount).fill('');
  for (const p of Object.keys(top.pins)) netNames[netOf(topPins[p])] = p;
  for (const [raw, name] of names) {
    const id = netOf(raw);
    if (!netNames[id]) netNames[id] = name;
  }

  const driver: number[] = new Array(netCount).fill(-2);
  const claim = (net: number, who: number) => {
    if (driver[net] !== -2) throw new Error(`Net "${netNames[net]}" has more than one driver`);
    driver[net] = who;
  };
  for (const p of inputPins(top)) claim(inputs[p], -1);
  for (const g of gates) for (const o of g.outputs) claim(o, g.id);
  driver.forEach((d, net) => {
    if (d === -2) throw new Error(`Net "${netNames[net]}" has no driver`);
  });

  const fanout: number[][] = Array.from({ length: netCount }, () => []);
  for (const g of gates) for (const i of new Set(g.inputs)) fanout[i].push(g.id);

  return { top, netCount, netNames, gates, fanout, driver, inputs, outputs, instances, pinNet };
}

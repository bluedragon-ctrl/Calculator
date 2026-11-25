// Component library + `defineComponent` validation (DESIGN.md §8.1).
import type { CmosNet, ComponentDef, PinDef, PinRef } from './types';

export class DefinitionError extends Error {
  constructor(component: string, message: string) {
    super(`${component}: ${message}`);
    this.name = 'DefinitionError';
  }
}

/** Input pin names in declaration order. */
export function inputPins(def: ComponentDef): string[] {
  return Object.keys(def.pins).filter((p) => def.pins[p].dir === 'in');
}

/** Output pin names in declaration order. */
export function outputPins(def: ComponentDef): string[] {
  return Object.keys(def.pins).filter((p) => def.pins[p].dir === 'out');
}

/** True when this component is simulated as a single behavioural node. */
export function isLeaf(def: ComponentDef): boolean {
  return !!def.behavior && (!def.parts || def.simulateAs === 'behavior');
}

export function splitRef(ref: PinRef): { part: string | null; pin: string } {
  const dot = ref.indexOf('.');
  return dot < 0 ? { part: null, pin: ref } : { part: ref.slice(0, dot), pin: ref.slice(dot + 1) };
}

export function cmosInputs(net: CmosNet): string[] {
  return net.kind === 'fet' ? [net.input] : net.parts.flatMap(cmosInputs);
}

export class Library {
  private readonly defs = new Map<string, ComponentDef>();

  /** Validate and register a component. Parts must be defined before the components using them. */
  define(def: ComponentDef): ComponentDef {
    if (this.defs.has(def.name)) throw new DefinitionError(def.name, 'already defined');
    validate(def, this);
    this.defs.set(def.name, def);
    return def;
  }

  get(name: string): ComponentDef {
    const d = this.defs.get(name);
    if (!d) throw new Error(`Unknown component "${name}"`);
    return d;
  }

  has(name: string): boolean {
    return this.defs.has(name);
  }

  names(): string[] {
    return [...this.defs.keys()];
  }
}

export function defineComponent(lib: Library, def: ComponentDef): ComponentDef {
  return lib.define(def);
}

function validate(def: ComponentDef, lib: Library): void {
  const fail = (msg: string): never => {
    throw new DefinitionError(def.name, msg);
  };
  const [w, h] = def.size;
  if (!(w > 0 && h > 0)) fail('size must be positive');
  if (def.innerScale !== undefined && !(def.innerScale > 0)) fail('innerScale must be positive');

  for (const [name, pin] of Object.entries(def.pins)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`bad pin name "${name}"`);
    const len = pin.side === 'left' || pin.side === 'right' ? h : w;
    if (pin.at < 0 || pin.at > len) fail(`pin "${name}" is outside the box`);
  }
  if (outputPins(def).length === 0) fail('needs at least one output pin');

  const hasStructure = !!def.parts || !!def.nets;
  if (!def.behavior && !hasStructure) fail('needs a behavior or a structure');
  if (def.simulateAs === 'behavior' && !def.behavior) fail('simulateAs "behavior" needs a behavior');
  if (def.behavior && !(def.behavior.delay >= 0)) fail('behavior delay must be ≥ 0');
  const clocked = def.behavior?.clocked;
  if (clocked) {
    for (const p of [clocked.d, clocked.clk]) {
      if (def.pins[p]?.dir !== 'in') fail(`clocked behavior needs an input pin "${p}"`);
    }
  }

  if (def.cmos) {
    const outs = outputPins(def);
    if (outs.length !== 1) fail('a CMOS gate has exactly one output');
    const ins = new Set(inputPins(def));
    const { pullUp, pullDown } = def.cmos;
    for (const i of [...cmosInputs(pullUp), ...(pullDown ? cmosInputs(pullDown) : [])]) {
      if (!ins.has(i)) fail(`CMOS network uses unknown input "${i}"`);
    }
  }

  for (const [name, bus] of Object.entries(def.buses ?? {})) {
    if (bus.pins.length === 0) fail(`bus "${name}" has no pins`);
    const dirs = new Set<string>();
    for (const p of bus.pins) {
      if (!def.pins[p]) fail(`bus "${name}" uses unknown pin "${p}"`);
      dirs.add(def.pins[p].dir);
    }
    if (dirs.size > 1) fail(`bus "${name}" mixes inputs and outputs`);
  }

  if (hasStructure) validateStructure(def, lib, fail);
  else if (def.powerOn) fail('powerOn needs a structure');
}

function validateStructure(def: ComponentDef, lib: Library, fail: (m: string) => never): void {
  const parts = def.parts ?? {};
  const nets = def.nets ?? [];
  for (const [name, part] of Object.entries(parts)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) fail(`bad part name "${name}"`);
    if (!lib.has(part.type)) fail(`part "${name}" has unknown type "${part.type}"`);
  }

  const pinOf = (ref: PinRef): PinDef => {
    const { part, pin } = splitRef(ref);
    if (part === null) {
      const p = def.pins[pin];
      if (!p) fail(`unknown pin "${ref}"`);
      return p;
    }
    const pd = parts[part];
    if (!pd) fail(`unknown part in "${ref}"`);
    const p = lib.get(pd.type).pins[pin];
    if (!p) fail(`unknown pin "${ref}"`);
    return p;
  };
  const isDriver = (ref: PinRef) => {
    const p = pinOf(ref);
    return splitRef(ref).part === null ? p.dir === 'in' : p.dir === 'out';
  };

  const used = new Set<string>();
  const mark = (ref: PinRef) => {
    if (used.has(ref)) fail(`"${ref}" is connected more than once (each net needs exactly one driver)`);
    used.add(ref);
  };
  for (const net of nets) {
    if (!isDriver(net.from)) fail(`"${net.from}" cannot drive a net`);
    mark(net.from);
    if (net.to.length === 0) fail(`net from "${net.from}" has no sinks`);
    for (const t of net.to) {
      if (isDriver(t)) fail(`"${t}" is a driver, but net from "${net.from}" uses it as a sink`);
      mark(t);
    }
    for (const r of Object.keys(net.routes ?? {})) {
      if (!net.to.includes(r)) fail(`route for "${r}" which is not a sink of net "${net.from}"`);
    }
  }

  for (const [ref, v] of Object.entries(def.powerOn ?? {})) {
    if (v !== 0 && v !== 1) fail(`powerOn value of "${ref}" must be 0 or 1`);
    if (!nets.some((n) => n.from === ref)) fail(`powerOn "${ref}" is not the driver of a net`);
  }

  for (const p of Object.keys(def.pins)) if (!used.has(p)) fail(`pin "${p}" is not connected`);
  for (const [name, part] of Object.entries(parts)) {
    for (const p of Object.keys(lib.get(part.type).pins)) {
      if (!used.has(`${name}.${p}`)) fail(`pin "${name}.${p}" is not connected`);
    }
  }
}

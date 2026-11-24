// Core data types for circuit definitions (DESIGN.md §5.2, §8.1).
// Pure data: no rendering or DOM imports anywhere in src/sim.

export type Bit = 0 | 1;
export type Point = readonly [number, number];
export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface PinDef {
  dir: 'in' | 'out';
  side: Side;
  /** Distance along the side, in box units: from the top for left/right, from the left for top/bottom. */
  at: number;
}

export interface PartDef {
  /** Name of another component in the same library. */
  type: string;
  /** Top-left corner in the parent's inner coordinates. */
  at: Point;
  /** Short name shown on the box and in the breadcrumb, e.g. "bit 3". */
  label?: string;
}

/** A group of single-bit pins read together as a number (DESIGN.md §6.4: decimal + binary). */
export interface BusDef {
  /** Pin names, least significant bit first. */
  pins: string[];
  /** Read as two's complement (−128…127 for 8 bits). Default true. */
  signed?: boolean;
}

/** A pin reference: `'a'` (own pin) or `'x1.a'` (pin `a` of part `x1`). */
export type PinRef = string;

export interface NetDef {
  /** The single driver: an own input pin or a part's output pin. */
  from: PinRef;
  /** Sinks: own output pins or parts' input pins. */
  to: PinRef[];
  /** Optional name shown in tooltips; defaults to the driver ref. */
  name?: string;
  /**
   * Optional waypoints per sink (inner coordinates). The wire goes driver → waypoints → sink,
   * with automatic orthogonal routing for the last leg. Sinks without an entry are auto-routed.
   */
  routes?: Record<PinRef, Point[]>;
}

/** Behaviour of a leaf: inputs in declared pin order → outputs in declared pin order. */
export interface Behavior {
  /** Delay in delta steps (DESIGN.md §5.1: every primitive gate has delay 1). */
  delay: number;
  /** `state` is the stored bit of a clocked leaf (always 0 for plain gates). */
  eval(inputs: readonly Bit[], state: Bit): Bit[];
  /**
   * Rising-edge storage (a behavioural D flip-flop, DESIGN.md §5.3). The simulator keeps one
   * stored bit per instance and loads it from input `d` on every clock tick; `eval` turns the
   * stored bit into the outputs. The `clk` pin is named so a structural copy can be driven.
   */
  clocked?: { d: string; clk: string };
}

/**
 * Series/parallel description of a CMOS transistor network. A leaf is one transistor whose
 * gate is driven by the named input pin.
 */
export type CmosNet =
  | { kind: 'fet'; input: string }
  | { kind: 'series'; parts: CmosNet[] }
  | { kind: 'parallel'; parts: CmosNet[] };

export interface CmosDef {
  /** PMOS network between VDD and the output. */
  pullUp: CmosNet;
  /** NMOS network between the output and GND. */
  pullDown: CmosNet;
}

export type GateSymbol = 'not' | 'and' | 'nand' | 'or' | 'nor' | 'xor';

export interface ComponentDef {
  name: string;
  title: string;
  /** One sentence for tooltips and panels. */
  blurb: string;
  /** Box size in the parent's coordinates. Pin `at` values use these units. */
  size: Point;
  /** Inner coordinates per box unit (inner frame = size × innerScale). Default 6. */
  innerScale?: number;
  pins: Record<string, PinDef>;
  parts?: Record<string, PartDef>;
  nets?: NetDef[];
  behavior?: Behavior;
  /** Transistor-level structure of a primitive gate. */
  cmos?: CmosDef;
  /** How to draw the closed box; plain rectangle when absent. */
  symbol?: GateSymbol;
  /** Keep this instance as one behavioural node when flattening, even if it has a structure. */
  simulateAs?: 'behavior';
  /** Pins that together form numbers, keyed by the bus name shown to students (e.g. `A`). */
  buses?: Record<string, BusDef>;
  /**
   * Power-on values of nets inside this component, keyed by their driver (e.g. `{ 'n3.y': 0 }`).
   * Cross-coupled latches need them: with every net at 0 they would oscillate (DESIGN.md §11).
   */
  powerOn?: Record<PinRef, Bit>;
}

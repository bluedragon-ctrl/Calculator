// Memory (DESIGN.md §4.2, §5.2, §9 Phase 3): SR latch → D latch → D flip-flop → register.
// Layouts are hand-authored in each inner frame (y down); data flows left → right.
//
// Power-on (DESIGN.md §11): with every net at 0, a cross-coupled latch would oscillate in a
// unit-delay simulation. Each latch therefore starts in a defined reset state (Q = 0) through
// `powerOn`, matching "all registers reset to 0" (§5.4).
import { defineComponent, type Library } from '../sim/library';
import type { ComponentDef, NetDef, PartDef, PinDef } from '../sim/types';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];

// Inner frame 16 × 12 (innerScale 4). Two NOR gates, each feeding the other: the classic
// crossed wires. R resets Q to 0, S sets it to 1.
export const SRLatch: ComponentDef = {
  name: 'SRLatch',
  title: 'SR latch',
  blurb: 'Remembers one bit. S (set) makes Q = 1, R (reset) makes Q = 0. With both at 0 it keeps its value.',
  size: [4, 3],
  innerScale: 4,
  pins: {
    r: { dir: 'in', side: 'left', at: 0.625 },
    s: { dir: 'in', side: 'left', at: 2.125 },
    q: { dir: 'out', side: 'right', at: 0.75 },
    qn: { dir: 'out', side: 'right', at: 2 },
  },
  parts: {
    n1: { type: 'NOR2', at: [7, 2] },
    n2: { type: 'NOR2', at: [7, 7] },
  },
  nets: [
    { from: 'r', to: ['n1.a'] },
    { from: 's', to: ['n2.b'] },
    { from: 'n1.y', to: ['q', 'n2.a'], name: 'q', routes: { 'n2.a': [[12, 3], [12, 5.2], [5, 5.2], [5, 7.5]] } },
    { from: 'n2.y', to: ['qn', 'n1.b'], name: 'qn', routes: { 'n1.b': [[13.5, 8], [13.5, 5.8], [4, 5.8], [4, 3.5]] } },
  ],
  powerOn: { 'n1.y': 0, 'n2.y': 1 },
};

// Inner frame 16 × 12 (innerScale 4). Four NAND gates: n1 and n2 let D through while E = 1,
// n3 and n4 are a cross-coupled pair that holds the bit. D and Q are at the same height, so
// latches chain in a straight line (master → slave).
export const DLatch: ComponentDef = {
  name: 'DLatch',
  title: 'D latch',
  blurb: 'Remembers one bit. While E (enable) is 1, Q follows D. When E goes to 0, Q keeps the last value.',
  size: [4, 3],
  innerScale: 4,
  pins: {
    d: { dir: 'in', side: 'left', at: 0.625 },
    e: { dir: 'in', side: 'left', at: 2.125 },
    q: { dir: 'out', side: 'right', at: 0.625 },
  },
  parts: {
    n1: { type: 'NAND2', at: [3, 2] },
    n2: { type: 'NAND2', at: [3, 7] },
    n3: { type: 'NAND2', at: [10, 1.5] },
    n4: { type: 'NAND2', at: [10, 7] },
  },
  nets: [
    { from: 'd', to: ['n1.a'] },
    { from: 'e', to: ['n2.b', 'n1.b'], routes: { 'n1.b': [[1.5, 8.5], [1.5, 3.5]] } },
    {
      from: 'n1.y', to: ['n3.a', 'n2.a'], name: 'n1',
      routes: { 'n3.a': [[7, 3], [7, 2]], 'n2.a': [[7, 3], [7, 5.5], [2.2, 5.5], [2.2, 7.5]] },
    },
    { from: 'n2.y', to: ['n4.b'], name: 'n2' },
    { from: 'n3.y', to: ['q', 'n4.a'], name: 'q', routes: { 'n4.a': [[14, 2.5], [14, 5.2], [8.5, 5.2], [8.5, 7.5]] } },
    { from: 'n4.y', to: ['n3.b'], name: 'qn', routes: { 'n3.b': [[15, 8], [15, 5.8], [8, 5.8], [8, 3]] } },
  ],
  powerOn: { 'n1.y': 1, 'n2.y': 1, 'n3.y': 0, 'n4.y': 1 },
};

// Inner frame 20 × 14 (innerScale 4). Master–slave: the master latch is open while the clock
// is 0, the slave while it is 1. So Q only takes D at the moment the clock rises.
// In the full machine it is simulated as one behavioural node (DESIGN.md §5.2).
export const DFF: ComponentDef = {
  name: 'DFF',
  title: 'D flip-flop',
  blurb: 'Stores the value of D at the moment the clock rises (0 → 1), and holds it until the next tick.',
  size: [5, 3.5],
  innerScale: 4,
  pins: {
    d: { dir: 'in', side: 'left', at: 0.625 },
    clk: { dir: 'in', side: 'left', at: 2.75 },
    q: { dir: 'out', side: 'right', at: 0.625 },
  },
  parts: {
    master: { type: 'DLatch', at: [3, 1.875], label: 'master' },
    slave: { type: 'DLatch', at: [11, 1.875], label: 'slave' },
    inv: { type: 'NOT', at: [5, 8] },
  },
  nets: [
    { from: 'd', to: ['master.d'] },
    { from: 'clk', to: ['inv.a', 'slave.e'], routes: { 'inv.a': [[4, 11], [4, 9]], 'slave.e': [[9.5, 11], [9.5, 4]] } },
    { from: 'inv.y', to: ['master.e'], name: 'not clk', routes: { 'master.e': [[8, 9], [8, 6.5], [2, 6.5], [2, 4]] } },
    { from: 'master.q', to: ['slave.d'], name: 'm' },
    { from: 'slave.q', to: ['q'], name: 'q' },
  ],
  powerOn: { 'inv.y': 1 },
  behavior: { delay: 1, eval: (_inputs, stored) => [stored], clocked: { d: 'd', clk: 'clk' } },
  simulateAs: 'behavior',
};

// Inner frame 17 × 6 (innerScale 2). A multiplexer in front of the flip-flop picks what is
// stored at the next tick: its own Q (hold) or D (load).
export const RegBit: ComponentDef = {
  name: 'RegBit',
  title: 'Register bit',
  blurb: 'One bit of a register: a flip-flop, and a multiplexer that picks "keep Q" or "load D" for the next tick.',
  size: [8.5, 3],
  innerScale: 2,
  pins: {
    load: { dir: 'in', side: 'left', at: 1.25 },
    d: { dir: 'in', side: 'left', at: 1.75 },
    clk: { dir: 'in', side: 'left', at: 2.3125 },
    q: { dir: 'out', side: 'right', at: 1.25 },
  },
  parts: {
    mux: { type: 'MUX2', at: [3, 1.125], label: 'keep or load' },
    dff: { type: 'DFF', at: [9, 1.875] },
  },
  nets: [
    { from: 'load', to: ['mux.s'] },
    { from: 'd', to: ['mux.b'] },
    { from: 'clk', to: ['dff.clk'] },
    { from: 'mux.y', to: ['dff.d'], name: 'next' },
    { from: 'dff.q', to: ['q', 'mux.a'], name: 'q', routes: { 'mux.a': [[15.5, 2.5], [15.5, 0.5], [2, 0.5], [2, 1.5]] } },
  ],
};

/** Row pitch of the bits in Register8. */
const ROW = 4;

// Inner frame 16.5 × 36 (innerScale 1). Eight register bits stacked, bit 0 on top. CLK and
// LOAD come in at the bottom left and run up to every bit.
function register8(): ComponentDef {
  const pins: Record<string, PinDef> = {};
  const parts: Record<string, PartDef> = {};
  const nets: NetDef[] = [];
  const top = (i: number) => 1 + ROW * i;
  for (const i of BITS) pins[`d${i}`] = { dir: 'in', side: 'left', at: top(i) + 1.75 };
  pins.clk = { dir: 'in', side: 'left', at: 33.5 };
  pins.load = { dir: 'in', side: 'left', at: 35 };
  for (const i of BITS) pins[`q${i}`] = { dir: 'out', side: 'right', at: top(i) + 1.25 };

  const clkRoutes: Record<string, [number, number][]> = {};
  const loadRoutes: Record<string, [number, number][]> = {};
  for (const i of BITS) {
    parts[`b${i}`] = { type: 'RegBit', at: [6, top(i)], label: `bit ${i}` };
    nets.push({ from: `d${i}`, to: [`b${i}.d`] });
    nets.push({ from: `b${i}.q`, to: [`q${i}`], name: `q${i}` });
    clkRoutes[`b${i}.clk`] = [[2, 33.5], [2, top(i) + 2.3125]];
    loadRoutes[`b${i}.load`] = [[4, 35], [4, top(i) + 1.25]];
  }
  nets.push({ from: 'clk', to: BITS.map((i) => `b${i}.clk`), routes: clkRoutes });
  nets.push({ from: 'load', to: BITS.map((i) => `b${i}.load`), routes: loadRoutes });

  return {
    name: 'Register8',
    title: '8-bit register',
    blurb: 'Eight flip-flops that store a number. At a clock tick it loads D if LOAD is 1; otherwise it keeps its value.',
    size: [16.5, 36],
    innerScale: 1,
    pins,
    parts,
    nets,
    buses: {
      D: { pins: BITS.map((i) => `d${i}`) },
      Q: { pins: BITS.map((i) => `q${i}`) },
    },
  };
}

export const Register8 = register8();

export const REGISTERS: ComponentDef[] = [SRLatch, DLatch, DFF, RegBit, Register8];

export function defineRegisters(lib: Library): void {
  for (const d of REGISTERS) defineComponent(lib, d);
}

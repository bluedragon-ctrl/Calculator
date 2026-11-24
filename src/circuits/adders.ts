// Adders (DESIGN.md §4.2, §9 Phase 2): half adder → full adder → 8-bit ripple-carry adder →
// 8-bit adder/subtractor with overflow. Layouts are hand-authored in each inner frame
// (y down); data flows left → right, carries flow top → bottom.
import { defineComponent, type Library } from '../sim/library';
import type { ComponentDef, NetDef, PartDef, PinDef } from '../sim/types';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];

// Inner frame 12 × 8. XOR makes the sum, AND makes the carry.
export const HalfAdder: ComponentDef = {
  name: 'HalfAdder',
  title: 'Half adder',
  blurb: 'Adds two bits. The sum is 1 when exactly one input is 1; the carry is 1 when both are.',
  size: [3, 2],
  innerScale: 4,
  pins: {
    a: { dir: 'in', side: 'left', at: 0.5 },
    b: { dir: 'in', side: 'left', at: 1.5 },
    s: { dir: 'out', side: 'right', at: 0.5 },
    c: { dir: 'out', side: 'right', at: 1.5 },
  },
  parts: {
    x: { type: 'XOR2', at: [5, 0.5] },
    n: { type: 'AND2', at: [5, 5] },
  },
  nets: [
    { from: 'a', to: ['x.a', 'n.a'], routes: { 'x.a': [[1.5, 2], [1.5, 1]], 'n.a': [[1.5, 2], [1.5, 5.5]] } },
    { from: 'b', to: ['n.b', 'x.b'], routes: { 'n.b': [[3.5, 6], [3.5, 6.5]], 'x.b': [[3.5, 6], [3.5, 2]] } },
    { from: 'x.y', to: ['s'], name: 'sum' },
    { from: 'n.y', to: ['c'], name: 'carry' },
  ],
};

// Inner frame 16 × 8. Two half adders and an OR. The carry enters at the top and leaves at
// the bottom, in the same column, so full adders stack into a straight carry chain.
export const FullAdder: ComponentDef = {
  name: 'FullAdder',
  title: 'Full adder',
  blurb: 'Adds three bits (a, b and the carry coming in) and gives a sum bit and a carry out.',
  size: [4, 2],
  innerScale: 4,
  pins: {
    a: { dir: 'in', side: 'left', at: 0.5 },
    b: { dir: 'in', side: 'left', at: 1.5 },
    cin: { dir: 'in', side: 'top', at: 3.75 },
    s: { dir: 'out', side: 'right', at: 0.75 },
    cout: { dir: 'out', side: 'bottom', at: 3.75 },
  },
  parts: {
    h1: { type: 'HalfAdder', at: [1.5, 3.5], label: 'a + b' },
    h2: { type: 'HalfAdder', at: [6.5, 2.5], label: '+ carry in' },
    o: { type: 'OR2', at: [11, 3.5], label: 'carry out' },
  },
  nets: [
    { from: 'a', to: ['h1.a'] },
    { from: 'b', to: ['h1.b'] },
    { from: 'h1.s', to: ['h2.b'], name: 'a+b' },
    { from: 'cin', to: ['h2.a'], routes: { 'h2.a': [[15, 1], [5.5, 1], [5.5, 3]] } },
    { from: 'h2.s', to: ['s'], name: 'sum' },
    { from: 'h1.c', to: ['o.b'], name: 'carry1' },
    { from: 'h2.c', to: ['o.a'], name: 'carry2' },
    { from: 'o.y', to: ['cout'], name: 'cout' },
  ],
};

/** Row pitch of the bit slices in Adder8 and AddSub8. */
const ROW = 3.5;

// Inner frame 8 × 29.5 (innerScale 1). Eight full adders in a column, bit 0 at the top.
function adder8(): ComponentDef {
  const pins: Record<string, PinDef> = {};
  const parts: Record<string, PartDef> = {};
  const nets: NetDef[] = [];
  for (const i of BITS) {
    pins[`a${i}`] = { dir: 'in', side: 'left', at: 2 + ROW * i };
    pins[`b${i}`] = { dir: 'in', side: 'left', at: 3 + ROW * i };
  }
  pins.cin = { dir: 'in', side: 'top', at: 5.75 };
  for (const i of BITS) pins[`s${i}`] = { dir: 'out', side: 'right', at: 2.25 + ROW * i };
  pins.c7 = { dir: 'out', side: 'right', at: 25.25 };
  pins.cout = { dir: 'out', side: 'bottom', at: 5.75 };

  for (const i of BITS) {
    parts[`fa${i}`] = { type: 'FullAdder', at: [2, 1.5 + ROW * i], label: `bit ${i}` };
    nets.push({ from: `a${i}`, to: [`fa${i}.a`] });
    nets.push({ from: `b${i}`, to: [`fa${i}.b`] });
    nets.push({ from: `fa${i}.s`, to: [`s${i}`], name: `s${i}` });
  }
  nets.push({ from: 'cin', to: ['fa0.cin'], name: 'c0' });
  for (const i of BITS.slice(0, 6)) nets.push({ from: `fa${i}.cout`, to: [`fa${i + 1}.cin`], name: `c${i + 1}` });
  nets.push({ from: 'fa6.cout', to: ['fa7.cin', 'c7'], name: 'c7', routes: { c7: [[5.75, 25.25]] } });
  nets.push({ from: 'fa7.cout', to: ['cout'], name: 'c8' });

  return {
    name: 'Adder8',
    title: '8-bit adder',
    blurb: 'Adds two 8-bit numbers with eight full adders. Each carry ripples into the next bit.',
    size: [8, 29.5],
    innerScale: 1,
    pins,
    parts,
    nets,
    buses: {
      A: { pins: BITS.map((i) => `a${i}`) },
      B: { pins: BITS.map((i) => `b${i}`) },
      S: { pins: BITS.map((i) => `s${i}`) },
    },
  };
}

export const Adder8 = adder8();

// Inner frame 22 × 35 (innerScale 2). B' = B XOR SUB, carry in = SUB,
// V = carry into bit 7 XOR carry out of bit 7 (DESIGN.md §4.2).
function addSub8(): ComponentDef {
  const pins: Record<string, PinDef> = {};
  const parts: Record<string, PartDef> = {};
  const nets: NetDef[] = [];
  const s = 2; // innerScale: pin `at` values are in box units
  pins.sub = { dir: 'in', side: 'top', at: 1.5 / s };
  for (const i of BITS) {
    pins[`a${i}`] = { dir: 'in', side: 'left', at: (4 + ROW * i) / s };
    pins[`b${i}`] = { dir: 'in', side: 'left', at: (5 + ROW * i) / s };
  }
  for (const i of BITS) pins[`r${i}`] = { dir: 'out', side: 'right', at: (4.25 + ROW * i) / s };
  pins.v = { dir: 'out', side: 'right', at: 32.5 / s };

  parts.add = { type: 'Adder8', at: [8, 2] };
  for (const i of BITS) parts[`x${i}`] = { type: 'XOR2', at: [3, 4.5 + ROW * i], label: `bit ${i}` };
  parts.xv = { type: 'XOR2', at: [17.5, 31.5], label: 'overflow' };

  const subRoutes: Record<string, [number, number][]> = { 'add.cin': [[1.5, 1], [13.75, 1]] };
  for (const i of BITS) subRoutes[`x${i}.b`] = [[1.5, 6 + ROW * i]];
  nets.push({ from: 'sub', to: [...BITS.map((i) => `x${i}.b`), 'add.cin'], routes: subRoutes });
  for (const i of BITS) {
    nets.push({ from: `a${i}`, to: [`add.a${i}`] });
    nets.push({ from: `b${i}`, to: [`x${i}.a`] });
    nets.push({ from: `x${i}.y`, to: [`add.b${i}`], name: `b'${i}` });
    nets.push({ from: `add.s${i}`, to: [`r${i}`], name: `r${i}` });
  }
  nets.push({ from: 'add.c7', to: ['xv.a'], name: 'c7', routes: { 'xv.a': [[16.75, 27.25], [16.75, 32]] } });
  nets.push({ from: 'add.cout', to: ['xv.b'], name: 'c8', routes: { 'xv.b': [[13.75, 33]] } });
  nets.push({ from: 'xv.y', to: ['v'], name: 'V' });

  return {
    name: 'AddSub8',
    title: '8-bit adder/subtractor',
    blurb: 'Adds or subtracts two 8-bit numbers. SUB = 1 flips the bits of B and adds 1, which subtracts.',
    size: [22 / s, 35 / s],
    innerScale: s,
    pins,
    parts,
    nets,
    buses: {
      A: { pins: BITS.map((i) => `a${i}`) },
      B: { pins: BITS.map((i) => `b${i}`) },
      R: { pins: BITS.map((i) => `r${i}`) },
    },
  };
}

export const AddSub8 = addSub8();

export const ADDERS: ComponentDef[] = [HalfAdder, FullAdder, Adder8, AddSub8];

export function defineAdders(lib: Library): void {
  for (const d of ADDERS) defineComponent(lib, d);
}

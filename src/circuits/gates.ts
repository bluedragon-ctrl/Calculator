// Composite gates built from primitives (DESIGN.md §5.2): students discover that
// "AND is secretly NAND + NOT".
import { defineComponent, type Library } from '../sim/library';
import type { ComponentDef } from '../sim/types';

const twoInputPins = {
  a: { dir: 'in', side: 'left', at: 0.5 },
  b: { dir: 'in', side: 'left', at: 1.5 },
  y: { dir: 'out', side: 'right', at: 1 },
} as const;

// Inner frame 18 × 12 (size 3 × 2, innerScale 6): a at y=3, b at y=9, y at y=6.

export const AND2: ComponentDef = {
  name: 'AND2',
  title: 'AND gate',
  blurb: 'Gives 1 only when both inputs are 1. Inside: a NAND followed by a NOT.',
  size: [3, 2],
  pins: { ...twoInputPins },
  symbol: 'and',
  parts: {
    n1: { type: 'NAND2', at: [4, 5] },
    inv: { type: 'NOT', at: [11, 5] },
  },
  nets: [
    { from: 'a', to: ['n1.a'] },
    { from: 'b', to: ['n1.b'] },
    { from: 'n1.y', to: ['inv.a'], name: 'nand' },
    { from: 'inv.y', to: ['y'] },
  ],
};

export const OR2: ComponentDef = {
  name: 'OR2',
  title: 'OR gate',
  blurb: 'Gives 1 when at least one input is 1. Inside: a NOR followed by a NOT.',
  size: [3, 2],
  pins: { ...twoInputPins },
  symbol: 'or',
  parts: {
    n1: { type: 'NOR2', at: [4, 5] },
    inv: { type: 'NOT', at: [11, 5] },
  },
  nets: [
    { from: 'a', to: ['n1.a'] },
    { from: 'b', to: ['n1.b'] },
    { from: 'n1.y', to: ['inv.a'], name: 'nor' },
    { from: 'inv.y', to: ['y'] },
  ],
};

export const XOR2: ComponentDef = {
  name: 'XOR2',
  title: 'XOR gate',
  blurb: 'Gives 1 when the inputs are different. Built from four NAND gates.',
  size: [3, 2],
  pins: { ...twoInputPins },
  symbol: 'xor',
  parts: {
    n1: { type: 'NAND2', at: [5, 5] },
    n2: { type: 'NAND2', at: [10, 2] },
    n3: { type: 'NAND2', at: [10, 8] },
    n4: { type: 'NAND2', at: [14, 5] },
  },
  nets: [
    { from: 'a', to: ['n1.a', 'n2.a'], routes: { 'n2.a': [[2, 3], [2, 2.5]] } },
    { from: 'b', to: ['n1.b', 'n3.b'], routes: { 'n3.b': [[2, 9], [2, 9.5]] } },
    { from: 'n1.y', to: ['n2.b', 'n3.a'], name: 'n1' },
    { from: 'n2.y', to: ['n4.a'], name: 'n2' },
    { from: 'n3.y', to: ['n4.b'], name: 'n3' },
    { from: 'n4.y', to: ['y'] },
  ],
};

export const GATES: ComponentDef[] = [AND2, OR2, XOR2];

export function defineGates(lib: Library): void {
  for (const d of GATES) defineComponent(lib, d);
}

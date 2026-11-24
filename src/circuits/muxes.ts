// Multiplexers (DESIGN.md §4.2): a 4-way mux from three 2-way muxes, and the 8-bit X input mux.
import { defineComponent, type Library } from '../sim/library';
import type { ComponentDef } from '../sim/types';
import { autoLayout, type AutoNet, type AutoPart } from './autoLayout';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];

// y = s1 ? (s0 ? d : c) : (s0 ? b : a). Two muxes pick with s0, a third picks with s1.
function mux4(lib: Library): ComponentDef {
  return autoLayout({
    name: 'MUX4',
    title: '4-way multiplexer',
    blurb: 'Picks one of four inputs: a, b, c or d, by the 2-bit number on s1 s0 (0, 1, 2 or 3).',
    inputs: ['a', 'b', 's0', 'c', 'd', 's1'],
    outputs: ['y'],
    parts: {
      m1: { type: 'MUX2', col: 1, label: 'a or b' },
      m2: { type: 'MUX2', col: 1, label: 'c or d' },
      m3: { type: 'MUX2', col: 2, label: 'pick with s1' },
    },
    nets: [
      { from: 'a', to: ['m1.a'] },
      { from: 'b', to: ['m1.b'] },
      { from: 'c', to: ['m2.a'] },
      { from: 'd', to: ['m2.b'] },
      { from: 's0', to: ['m1.s', 'm2.s'] },
      { from: 's1', to: ['m3.s'] },
      { from: 'm1.y', to: ['m3.a'], name: 'a or b' },
      { from: 'm2.y', to: ['m3.b'], name: 'c or d' },
      { from: 'm3.y', to: ['y'] },
    ],
    innerScale: 3,
  }, lib);
}

// Eight 4-way muxes side by side, one per bit, sharing the select lines.
function mux4x8(lib: Library): ComponentDef {
  const parts: Record<string, AutoPart> = {};
  const nets: AutoNet[] = [];
  for (const i of BITS) {
    parts[`m${i}`] = { type: 'MUX4', col: 1, label: `bit ${i}` };
    for (const src of ['a', 'b', 'c', 'd']) nets.push({ from: `${src}${i}`, to: [`m${i}.${src}`] });
    nets.push({ from: `m${i}.y`, to: [`y${i}`], name: `y${i}` });
  }
  nets.push({ from: 's0', to: BITS.map((i) => `m${i}.s0`) });
  nets.push({ from: 's1', to: BITS.map((i) => `m${i}.s1`) });
  const bus = (p: string) => ({ pins: BITS.map((i) => `${p}${i}`) });
  return autoLayout({
    name: 'MUX4x8',
    title: '8-bit 4-way multiplexer',
    blurb: 'Picks one of four 8-bit numbers (a, b, c or d) by the 2-bit select s1 s0. One 4-way mux per bit.',
    inputs: [...BITS.flatMap((i) => ['a', 'b', 'c', 'd'].map((s) => `${s}${i}`)), 's0', 's1'],
    outputs: BITS.map((i) => `y${i}`),
    parts,
    nets,
    innerScale: 1,
    gap: 1.5,
    extra: { buses: { a: bus('a'), b: bus('b'), c: bus('c'), d: bus('d'), y: bus('y') } },
  }, lib);
}

export function defineMuxes(lib: Library): void {
  defineComponent(lib, mux4(lib));
  defineComponent(lib, mux4x8(lib));
}

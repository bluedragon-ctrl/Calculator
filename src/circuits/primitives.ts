// Primitive gates: the transistor-level leaves (DESIGN.md §5.2).
import { defineComponent, type Library } from '../sim/library';
import type { Bit, CmosNet, ComponentDef, PinDef } from '../sim/types';

const fet = (input: string): CmosNet => ({ kind: 'fet', input });
const series = (inputs: string[]): CmosNet =>
  inputs.length === 1 ? fet(inputs[0]) : { kind: 'series', parts: inputs.map(fet) };
const parallel = (inputs: string[]): CmosNet =>
  inputs.length === 1 ? fet(inputs[0]) : { kind: 'parallel', parts: inputs.map(fet) };

const INPUT_NAMES = ['a', 'b', 'c', 'd'];

function gatePins(n: number): Record<string, PinDef> {
  const pins: Record<string, PinDef> = {};
  for (let i = 0; i < n; i++) pins[INPUT_NAMES[i]] = { dir: 'in', side: 'left', at: i + 0.5 };
  pins.y = { dir: 'out', side: 'right', at: n / 2 };
  return pins;
}

/** Four transistors side by side need a wider transistor view. */
const gateWidth = (n: number) => (n >= 4 ? 4 : 3);

const not = (v: boolean): Bit => (v ? 0 : 1);

export const NOT: ComponentDef = {
  name: 'NOT',
  title: 'NOT gate',
  blurb: 'Flips its input: 0 becomes 1 and 1 becomes 0.',
  size: [2, 2],
  pins: { a: { dir: 'in', side: 'left', at: 1 }, y: { dir: 'out', side: 'right', at: 1 } },
  behavior: { delay: 1, eval: ([a]) => [not(a === 1)] },
  cmos: { pullUp: fet('a'), pullDown: fet('a') },
  symbol: 'not',
};

function nand(n: number): ComponentDef {
  const ins = INPUT_NAMES.slice(0, n);
  return {
    name: `NAND${n}`,
    title: n === 2 ? 'NAND gate' : `${n}-input NAND gate`,
    blurb: 'Gives 0 only when all inputs are 1. Otherwise it gives 1.',
    size: [gateWidth(n), n],
    pins: gatePins(n),
    behavior: { delay: 1, eval: (v) => [not(v.every((x) => x === 1))] },
    cmos: { pullUp: parallel(ins), pullDown: series(ins) },
    symbol: 'nand',
  };
}

function nor(n: number): ComponentDef {
  const ins = INPUT_NAMES.slice(0, n);
  return {
    name: `NOR${n}`,
    title: n === 2 ? 'NOR gate' : `${n}-input NOR gate`,
    blurb: 'Gives 1 only when all inputs are 0. Otherwise it gives 0.',
    size: [gateWidth(n), n],
    pins: gatePins(n),
    behavior: { delay: 1, eval: (v) => [not(v.some((x) => x === 1))] },
    cmos: { pullUp: series(ins), pullDown: parallel(ins) },
    symbol: 'nor',
  };
}

export const PRIMITIVES: ComponentDef[] = [NOT, nand(2), nand(3), nand(4), nor(2), nor(3), nor(4)];

export function definePrimitives(lib: Library): void {
  for (const d of PRIMITIVES) defineComponent(lib, d);
}

// Exhaustive truth tables for every gate, simulated through the full engine.
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { flatten } from '../src/sim/flatten';
import { inputPins } from '../src/sim/library';
import { Simulator } from '../src/sim/simulator';
import type { Bit } from '../src/sim/types';
import { allInputs } from './helpers';

const and = (v: Bit[]) => v.every((x) => x === 1);
const or = (v: Bit[]) => v.some((x) => x === 1);
const b = (x: boolean): Bit => (x ? 1 : 0);

const expected: Record<string, (v: Bit[]) => Bit> = {
  NOT: ([a]) => b(a === 0),
  NAND2: (v) => b(!and(v)),
  NAND3: (v) => b(!and(v)),
  NAND4: (v) => b(!and(v)),
  NOR2: (v) => b(!or(v)),
  NOR3: (v) => b(!or(v)),
  NOR4: (v) => b(!or(v)),
  AND2: (v) => b(and(v)),
  OR2: (v) => b(or(v)),
  XOR2: ([x, y]) => b(x !== y),
};

describe('truth tables', () => {
  it('covers every component in the library', () => {
    expect(Object.keys(expected).sort()).toEqual(library.names().sort());
  });

  for (const [name, fn] of Object.entries(expected)) {
    it(name, () => {
      const def = library.get(name);
      const ins = inputPins(def);
      const sim = new Simulator(flatten(def, library));
      // Walk the rows in order and also in reverse, so every row is reached from different states.
      const rows = allInputs(ins.length);
      for (const row of [...rows, ...[...rows].reverse()]) {
        const inputs = Object.fromEntries(ins.map((p, i) => [p, row[i]]));
        expect(sim.apply(inputs).y, `${name}(${row.join(',')})`).toBe(fn(row));
        // A fresh simulator agrees (no hidden state).
        expect(new Simulator(flatten(def, library)).apply(inputs).y).toBe(fn(row));
      }
    });
  }
});

describe('structure', () => {
  it('AND2 is NAND + NOT, OR2 is NOR + NOT, XOR2 is four NANDs', () => {
    const types = (n: string) => flatten(library.get(n), library).gates.map((g) => g.def.name).sort();
    expect(types('AND2')).toEqual(['NAND2', 'NOT']);
    expect(types('OR2')).toEqual(['NOR2', 'NOT']);
    expect(types('XOR2')).toEqual(['NAND2', 'NAND2', 'NAND2', 'NAND2']);
  });
});

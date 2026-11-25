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
  MUX2: ([a, s, bb]) => (s ? bb : a),
};

/** The single-transistor bench parts: the lamp lights when the transistor conducts. */
const transistors: Record<string, (v: Bit[]) => Bit> = {
  NMOS: ([g]) => g,
  PMOS: ([g]) => b(g === 0),
};

describe('truth tables', () => {
  it('covers every gate in the library (adders and memory have their own test files)', () => {
    const adders = ['HalfAdder', 'FullAdder', 'Adder8', 'AddSub8'];
    const memory = ['SRLatch', 'DLatch', 'DFF', 'RegBit', 'Register8'];
    // Phase 4 parts are tested in parts.test.ts and calculator.test.ts.
    const calculator = [
      'CONST0', 'MUX4', 'MUX4x8', 'KeyEncoder', 'SetClearBit', 'KeyRegister', 'KeyClassDecoder', 'PLA', 'ControlUnit',
      'Flags', 'DisplayROM', 'ErrMux', 'SevenSegDecoder', 'ZeroDetect8', 'Calculator',
    ];
    expect([...Object.keys(expected), ...Object.keys(transistors), ...adders, ...memory, ...calculator].sort()).toEqual(library.names().sort());
  });

  for (const [name, fn] of Object.entries({ ...expected, ...transistors })) {
    it(name, () => {
      const def = library.get(name);
      const ins = inputPins(def);
      const sim = new Simulator(flatten(def, library));
      // Walk the rows in order and also in reverse, so every row is reached from different states.
      const rows = allInputs(ins.length);
      for (const row of [...rows, ...[...rows].reverse()]) {
        const inputs = Object.fromEntries(ins.map((p, i) => [p, row[i]]));
        expect(Object.values(sim.apply(inputs))[0], `${name}(${row.join(',')})`).toBe(fn(row));
        // A fresh simulator agrees (no hidden state).
        expect(Object.values(new Simulator(flatten(def, library)).apply(inputs))[0]).toBe(fn(row));
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
    expect(types('MUX2')).toEqual(['NAND2', 'NAND2', 'NAND2', 'NOT']);
  });
});

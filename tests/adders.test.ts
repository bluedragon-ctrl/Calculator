// Adders: exhaustive truth tables (≤ 10 inputs) and exhaustive arithmetic (DESIGN.md §10).
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { numberToBits } from '../src/sim/bus';
import { flatten } from '../src/sim/flatten';
import { Simulator } from '../src/sim/simulator';
import type { Bit } from '../src/sim/types';
import { allInputs } from './helpers';

const sim = (name: string) => new Simulator(flatten(library.get(name), library));

describe('HalfAdder', () => {
  it('truth table', () => {
    const s = sim('HalfAdder');
    for (const [a, b] of [...allInputs(2), ...allInputs(2).reverse()]) {
      const sum = a + b;
      expect(s.apply({ a, b }), `${a}+${b}`).toEqual({ s: sum & 1, c: sum >> 1 });
    }
  });
  it('is an XOR and an AND', () => {
    const types = flatten(library.get('HalfAdder'), library).gates.map((g) => g.path.split('.')[0]);
    expect(new Set(types)).toEqual(new Set(['x', 'n']));
  });
});

describe('FullAdder', () => {
  it('truth table', () => {
    const s = sim('FullAdder');
    for (const [a, b, cin] of [...allInputs(3), ...allInputs(3).reverse()]) {
      const sum = a + b + cin;
      expect(s.apply({ a, b, cin }), `${a}+${b}+${cin}`).toEqual({ s: sum & 1, cout: sum >> 1 });
    }
  });
});

/** Set the inputs of an 8-bit bus. */
function setBus(s: Simulator, prefix: string, v: number): void {
  numberToBits(v, 8).forEach((bit, i) => s.setInput(`${prefix}${i}`, bit));
}

function readBus(s: Simulator, prefix: string): number {
  let v = 0;
  for (let i = 0; i < 8; i++) v |= s.output(`${prefix}${i}`) << i;
  return v;
}

describe('Adder8', () => {
  it('adds every pair of bytes, with and without carry in (exhaustive, unsigned)', () => {
    const s = sim('Adder8');
    let fails = 0;
    for (const cin of [0, 1] as Bit[]) {
      s.setInput('cin', cin);
      for (let a = 0; a < 256; a++) {
        setBus(s, 'a', a);
        for (let b = 0; b < 256; b++) {
          setBus(s, 'b', b);
          s.settle();
          const total = a + b + cin;
          // c7 = carry into bit 7 = carry out of the low 7 bits.
          const c7 = ((a & 0x7f) + (b & 0x7f) + cin) >> 7;
          if (readBus(s, 's') !== (total & 0xff) || s.output('cout') !== total >> 8 || s.output('c7') !== c7) {
            if (fails++ < 5) expect.fail(`${a} + ${b} + ${cin}`);
          }
        }
      }
    }
    expect(fails).toBe(0);
  });
});

describe('AddSub8', () => {
  const toSigned = (v: number) => (v & 0x80 ? v - 256 : v);

  it('matches JS arithmetic for all 256 × 256 × {add, sub} (result + overflow)', () => {
    const s = sim('AddSub8');
    let checked = 0;
    let fails = 0;
    for (const sub of [0, 1] as Bit[]) {
      s.setInput('sub', sub);
      for (let a = -128; a < 128; a++) {
        setBus(s, 'a', a);
        for (let b = -128; b < 128; b++) {
          setBus(s, 'b', b);
          const t = s.settle();
          if (t.oscillating) expect.fail('oscillation');
          const exact = sub ? a - b : a + b;
          const wrapped = toSigned(exact & 0xff);
          const v = exact < -128 || exact > 127 ? 1 : 0;
          checked++;
          if (toSigned(readBus(s, 'r')) !== wrapped || s.output('v') !== v) {
            if (fails++ < 5) expect.fail(`${a} ${sub ? '-' : '+'} ${b}: got ${toSigned(readBus(s, 'r'))} v=${s.output('v')}`);
          }
        }
      }
    }
    expect(checked).toBe(131072);
    expect(fails).toBe(0);
  });

  it('the carry ripples: −1 + 1 takes longer to settle than 1 + 1', () => {
    const deltas = (a: number, b: number) => {
      const s = sim('AddSub8');
      setBus(s, 'a', a);
      s.settle();
      setBus(s, 'b', b);
      return s.settle().deltas;
    };
    expect(deltas(-1, 1)).toBeGreaterThan(deltas(1, 1) + 20);
  });

  it('uses B XOR SUB and carry in = SUB', () => {
    const c = flatten(library.get('AddSub8'), library);
    const sub = c.inputs.sub;
    expect(c.pinNet.get('add.cin')).toBe(sub);
    for (let i = 0; i < 8; i++) expect(c.pinNet.get(`x${i}.b`)).toBe(sub);
    expect(c.pinNet.get('xv.a')).toBe(c.pinNet.get('add.c7'));
    expect(c.pinNet.get('xv.b')).toBe(c.pinNet.get('add.cout'));
  });

  it('is deterministic', () => {
    const run = () => {
      const s = sim('AddSub8');
      setBus(s, 'a', 7);
      setBus(s, 'b', 9);
      return s.settle();
    };
    expect(run()).toEqual(run());
  });
});

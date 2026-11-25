// Behavioural vs switch-level (transistor) evaluation must agree for every primitive (DESIGN.md §10).
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { PRIMITIVES } from '../src/circuits/primitives';
import { inputPins } from '../src/sim/library';
import { cmosNetlist, countTransistors, evaluateSwitches, OUT } from '../src/sim/switchLevel';
import { allInputs } from './helpers';

describe('switch level', () => {
  for (const def of PRIMITIVES) {
    it(`${def.name}: transistors agree with the behaviour for every input`, () => {
      const net = cmosNetlist(def.cmos!);
      const ins = inputPins(def);
      for (const row of allInputs(ins.length)) {
        const r = evaluateSwitches(net, Object.fromEntries(ins.map((p, i) => [p, row[i]])));
        expect(r.out).toBe(def.behavior!.eval(row, 0)[0]);
        // Complementary CMOS: never a short, never floating, and a path always exists.
        expect(Object.values(r.level)).not.toContain('short');
        expect(r.path.length).toBeGreaterThan(0);
        for (const id of r.path) expect(r.on[id]).toBe(true);
      }
    });
  }

  it('NAND2: pull-up is two parallel PMOS, pull-down two series NMOS', () => {
    const net = cmosNetlist(library.get('NAND2').cmos!);
    expect(net.transistors.map((t) => `${t.type}:${t.input}:${t.a}-${t.b}`)).toEqual([
      'p:a:VDD-OUT', 'p:b:VDD-OUT', 'n:a:OUT-n1', 'n:b:n1-GND',
    ]);
    const r = evaluateSwitches(net, { a: 1, b: 1 });
    expect(r.out).toBe(0);
    expect(r.path).toEqual([2, 3]); // both NMOS conduct: output connected to GND
    const r2 = evaluateSwitches(net, { a: 1, b: 0 });
    expect(r2.out).toBe(1);
    expect(r2.path).toEqual([1]);
    expect(r2.level.n1).toBe('vdd'); // the middle node follows the output through the open NMOS a
  });

  it('a stuck transistor can float or short the output', () => {
    const net = cmosNetlist(library.get('NOT').cmos!);
    expect(evaluateSwitches(net, { a: 0 }, { 0: 'off' }).out).toBe('float');
    const short = evaluateSwitches(net, { a: 0 }, { 1: 'on' });
    expect(short.out).toBe('short');
    expect(short.level[OUT]).toBe('short');
  });

  it('counts transistors from the structure', () => {
    const count = (n: string) => countTransistors(library.get(n), library);
    expect(count('NOT')).toBe(2);
    expect(count('NAND2')).toBe(4);
    expect(count('NOR3')).toBe(6);
    expect(count('NAND4')).toBe(8);
    expect(count('AND2')).toBe(6);
    expect(count('XOR2')).toBe(16);
  });
});

describe('single-transistor bench parts', () => {
  it('one transistor between power and the lamp; the lamp wire floats when it is off', () => {
    for (const [name, type, onAt] of [['NMOS', 'n', 1], ['PMOS', 'p', 0]] as const) {
      const def = library.get(name);
      const net = cmosNetlist(def.cmos!);
      expect(net.transistors.map((t) => `${t.type}:${t.input}:${t.a}-${t.b}`)).toEqual([`${type}:g:VDD-OUT`]);
      for (const g of [0, 1] as const) {
        const r = evaluateSwitches(net, { g });
        expect(r.out).toBe(g === onAt ? 1 : 'float');
        // The behaviour (lamp lit) agrees: 1 when conducting, else no current (0).
        expect(def.behavior!.eval([g], 0)[0]).toBe(g === onAt ? 1 : 0);
      }
    }
  });
});

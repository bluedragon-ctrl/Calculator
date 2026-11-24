// Phase 4 parts (DESIGN.md §4.2, §4.3): exhaustive truth tables where a part has ≤ 10 inputs,
// and complete checks against JavaScript references for the bigger ones.
import { describe, expect, it } from 'vitest';
import { RULES, CONDITIONS, SIGNALS, STATES, activeRules, ruleOutputs, stateCode, XSRC } from '../src/circuits/control';
import { SEGMENTS, SEGMENT_NAMES, codeText } from '../src/circuits/display';
import { CODE_BLANK, DISPLAY_ROM, displayRow } from '../src/circuits/gen/displayRom';
import { minimise, termCovers } from '../src/circuits/gen/sop';
import { library } from '../src/circuits/library';
import { bitsToNumber, numberToBits } from '../src/sim/bus';
import { flatten } from '../src/sim/flatten';
import { inputPins, outputPins } from '../src/sim/library';
import { Simulator } from '../src/sim/simulator';
import type { Bit } from '../src/sim/types';
import { allInputs } from './helpers';

const make = (name: string) => new Simulator(flatten(library.get(name), library));
const BITS = [0, 1, 2, 3, 4, 5, 6, 7];
const bits4 = (v: number) => numberToBits(v, 4);

/** Drive the named inputs, settle, read outputs. */
function run(sim: Simulator, inputs: Record<string, number>): Record<string, Bit> {
  return sim.apply(inputs as Record<string, Bit>);
}

describe('two-level minimiser (generates the 7-segment decoder)', () => {
  it('every cover is exact for every 4-input function used, and for random ones', () => {
    const fns: number[][] = SEGMENT_NAMES.map((s) => [...Array(16).keys()].filter((c) => SEGMENTS[c].includes(s)));
    let seed = 7;
    for (let k = 0; k < 200; k++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      fns.push([...Array(16).keys()].filter((i) => (seed >> (i % 31)) & 1));
    }
    for (const ones of fns) {
      const terms = minimise(4, ones);
      for (let row = 0; row < 16; row++) expect(terms.some((t) => termCovers(t, row))).toBe(ones.includes(row));
    }
  });
});

describe('MUX4', () => {
  it('exhaustive: y = input chosen by s1 s0', () => {
    const sim = make('MUX4');
    const ins = inputPins(library.get('MUX4'));
    for (const row of allInputs(ins.length)) {
      const v = Object.fromEntries(ins.map((p, i) => [p, row[i]]));
      const sel = v.s0 + 2 * v.s1;
      expect(run(sim, v).y).toBe([v.a, v.b, v.c, v.d][sel]);
    }
  });

  it('is built from three 2-way muxes', () => {
    expect(Object.values(library.get('MUX4').parts!).map((p) => p.type)).toEqual(['MUX2', 'MUX2', 'MUX2']);
  });
});

describe('MUX4x8', () => {
  it('passes the selected 8-bit input for every select value (pseudo-random data, all 4 selects)', () => {
    const sim = make('MUX4x8');
    let seed = 3;
    const rnd = () => (seed = (seed * 75 + 74) % 65537) & 255;
    for (let k = 0; k < 60; k++) {
      const vals = [rnd(), rnd(), rnd(), rnd()];
      for (let sel = 0; sel < 4; sel++) {
        const inputs: Record<string, number> = { s0: sel & 1, s1: sel >> 1 };
        ['a', 'b', 'c', 'd'].forEach((src, q) => numberToBits(vals[q], 8).forEach((b, i) => (inputs[`${src}${i}`] = b)));
        const out = run(sim, inputs);
        expect(bitsToNumber(BITS.map((i) => out[`y${i}`]), false)).toBe(vals[sel]);
      }
    }
  });
});

describe('Keyboard encoder', () => {
  const sim = make('KeyEncoder');
  const lines = (on: number[]) => Object.fromEntries([...Array(16).keys()].map((k) => [`k${k}`, on.includes(k) ? 1 : 0]));
  const code = (o: Record<string, Bit>) => bitsToNumber([0, 1, 2, 3].map((i) => o[`c${i}`]), false);

  it('each single key line gives its 4-bit code and pressed = 1', () => {
    for (let k = 0; k < 16; k++) {
      const o = run(sim, lines([k]));
      expect(code(o), `key ${k}`).toBe(k);
      expect(o.pressed).toBe(1);
    }
  });

  it('no key: code 0 and pressed = 0', () => {
    const o = run(sim, lines([]));
    expect(code(o)).toBe(0);
    expect(o.pressed).toBe(0);
  });

  it('two keys at once give the OR of their codes (plain encoder, DESIGN.md §11)', () => {
    for (let a = 0; a < 16; a++) {
      for (let b = a + 1; b < 16; b++) expect(code(run(sim, lines([a, b])))).toBe(a | b);
    }
  });
});

describe('Key class decoder', () => {
  it('exhaustive: digit, operator, =, C, M, MR', () => {
    const sim = make('KeyClassDecoder');
    for (let k = 0; k < 16; k++) {
      const inputs: Record<string, number> = {};
      bits4(k).forEach((b, i) => (inputs[`k${i}`] = b));
      expect(run(sim, inputs), `key ${k}`).toEqual({
        isDigit: k < 10 ? 1 : 0, isOp: k === 10 || k === 11 ? 1 : 0, isEq: k === 12 ? 1 : 0,
        isC: k === 13 ? 1 : 0, isM: k === 14 ? 1 : 0, isMR: k === 15 ? 1 : 0,
      });
    }
  });
});

describe('Zero detect', () => {
  it('exhaustive over all 256 values', () => {
    const sim = make('ZeroDetect8');
    for (let v = 0; v < 256; v++) {
      const inputs: Record<string, number> = {};
      numberToBits(v, 8).forEach((b, i) => (inputs[`x${i}`] = b));
      expect(run(sim, inputs).zero).toBe(v === 0 ? 1 : 0);
    }
  });
});

describe('7-segment decoder', () => {
  it('exhaustive: every code lights exactly its segments (0-9, E, r, blank)', () => {
    const sim = make('SevenSegDecoder');
    for (let c = 0; c < 16; c++) {
      const inputs: Record<string, number> = {};
      bits4(c).forEach((b, i) => (inputs[`v${i}`] = b));
      const o = run(sim, inputs);
      const lit = SEGMENT_NAMES.filter((s) => o[s] === 1).join('');
      expect(lit, `code ${c}`).toBe(SEGMENTS[c]);
    }
  });

  it('is built from gates only', () => {
    const types = new Set(flatten(library.get('SevenSegDecoder'), library).gates.map((g) => g.def.name));
    for (const t of types) expect(library.get(t).cmos, t).toBeDefined();
  });
});

describe('Display ROM', () => {
  it('generator: all 256 entries match JavaScript formatting of the number', () => {
    for (let a = 0; a < 256; a++) {
      const v = a >= 128 ? a - 256 : a;
      const r = DISPLAY_ROM[a];
      const text = (r.sign ? '-' : ' ') + [r.hundreds, r.tens, r.ones].map((c) => (c === CODE_BLANK ? ' ' : String(c))).join('');
      // Fixed sign position on the left, number right-aligned in 3 digits, leading zeros blank.
      expect(text, `X = ${v}`).toBe((v < 0 ? '-' : ' ') + String(Math.abs(v)).padStart(3, ' '));
    }
    expect(displayRow(0)).toEqual({ sign: 0, hundreds: CODE_BLANK, tens: CODE_BLANK, ones: 0 });
    expect(displayRow(128)).toEqual({ sign: 1, hundreds: 1, tens: 2, ones: 8 });
  });

  it('the ROM part outputs its table for every address, and its table view lights that row', () => {
    const def = library.get('DisplayROM');
    const sim = make('DisplayROM');
    for (let a = 0; a < 256; a++) {
      const inputs: Record<string, number> = {};
      numberToBits(a, 8).forEach((b, i) => (inputs[`x${i}`] = b));
      const o = run(sim, inputs);
      const r = DISPLAY_ROM[a];
      expect(o.s).toBe(r.sign);
      for (const [d, c] of [['h', r.hundreds], ['t', r.tens], ['o', r.ones]] as const) {
        expect(bitsToNumber([0, 1, 2, 3].map((i) => o[`${d}${i}`]), false)).toBe(c);
      }
      expect(def.table!.active(numberToBits(a, 8))).toEqual([a]);
      expect(def.table!.rows[a].slice(3)).toEqual([r.hundreds, r.tens, r.ones].map(codeText));
    }
  });
});

describe('Err switch', () => {
  it('passes every ROM row through when E = 0 and shows "Err" codes when E = 1', () => {
    const sim = make('ErrMux');
    for (let a = 0; a < 256; a++) {
      const r = DISPLAY_ROM[a];
      for (const e of [0, 1]) {
        const inputs: Record<string, number> = { s: r.sign, e };
        for (const [d, c] of [['h', r.hundreds], ['t', r.tens], ['o', r.ones]] as const) bits4(c).forEach((b, i) => (inputs[`${d}${i}`] = b));
        const o = run(sim, inputs);
        const read = (d: string) => bitsToNumber([0, 1, 2, 3].map((i) => o[`${d}${i}`]), false);
        expect([o.S, read('H'), read('T'), read('O')]).toEqual(e ? [0, 10, 11, 11] : [r.sign, r.hundreds, r.tens, r.ones]);
      }
    }
  });

  it('each output bit depends only on its own input and E: exhaustive per bit', () => {
    const sim = make('ErrMux');
    for (const p of inputPins(library.get('ErrMux')).filter((q) => q !== 'e')) {
      for (const [v, e] of allInputs(2)) {
        const o = run(sim, { [p]: v, e });
        const out = p.toUpperCase();
        const constBit = out === 'S' ? 0 : ((out[0] === 'H' ? 10 : 11) >> Number(out[1])) & 1;
        expect(o[out], `${p}=${v} e=${e}`).toBe(e ? constBit : v);
      }
    }
  });
});

describe('Set/clear flag', () => {
  it('every input from every stored state: next = set OR (Q AND NOT clear)', () => {
    for (const q0 of [0, 1] as Bit[]) {
      for (const [set, clr] of allInputs(2)) {
        const sim = make('SetClearBit');
        sim.apply({ set: q0, clr: 0 });
        sim.tick();
        sim.apply({ set: 0, clr: 0 });
        expect(sim.output('q')).toBe(q0);
        sim.apply({ set, clr });
        expect(sim.output('q')).toBe(q0); // nothing changes before the tick
        sim.tick();
        expect(sim.output('q'), `q0=${q0} set=${set} clr=${clr}`).toBe(set || (q0 && !clr) ? 1 : 0);
      }
    }
  });
});

describe('Key register', () => {
  it('loads the code and sets READY only at a tick with pressed = 1; READY_CLR clears READY', () => {
    const sim = make('KeyRegister');
    const key = () => bitsToNumber([0, 1, 2, 3].map((i) => sim.output(`key${i}`)), false);
    for (let k = 0; k < 16; k++) {
      const code: Record<string, number> = {};
      bits4(k).forEach((b, i) => (code[`c${i}`] = b));
      run(sim, { ...code, pressed: 0, rclr: 0 });
      sim.tick();
      run(sim, { pressed: 1 });
      expect(sim.output('ready')).toBe(0);
      sim.tick();
      expect(key()).toBe(k);
      expect(sim.output('ready')).toBe(1);
      run(sim, { pressed: 0 });
      sim.tick();
      expect(sim.output('ready')).toBe(1); // stays until cleared
      run(sim, { rclr: 1 });
      sim.tick();
      expect(sim.output('ready')).toBe(0);
      expect(key()).toBe(k); // the code is kept
    }
  });
});

describe('Flags', () => {
  it('OP loads KEY bit 0; PEND sets and clears; E follows E_CLR ? 0 : (E_LOAD ? V : E)', () => {
    const ins = ['opload', 'key0', 'pendset', 'pendclr', 'v', 'eload', 'eclr'];
    // Every input combination from every stored (op, pend, e), with set/clear never both on.
    for (const [op0, pend0, e0] of allInputs(3)) {
      for (const row of allInputs(ins.length)) {
        const v = Object.fromEntries(ins.map((p, i) => [p, row[i]]));
        if (v.pendset && v.pendclr) continue;
        const sim = make('Flags');
        run(sim, { opload: 1, key0: op0, pendset: pend0, pendclr: 0, v: e0, eload: 1, eclr: 0 });
        sim.tick();
        expect([sim.output('op'), sim.output('pend'), sim.output('e')]).toEqual([op0, pend0, e0]);
        run(sim, v);
        sim.tick();
        expect(sim.output('op')).toBe(v.opload ? v.key0 : op0);
        expect(sim.output('pend')).toBe(v.pendset ? 1 : v.pendclr ? 0 : pend0);
        expect(sim.output('e')).toBe(v.eclr ? 0 : v.eload ? v.v : e0);
      }
    }
  });
});

describe('PLA rulebook (DESIGN.md §4.3)', () => {
  const def = library.get('PLA');
  const sim = make('PLA');
  const classOf = (k: number) => ({
    isDigit: +(k < 10), isOp: +(k === 10 || k === 11), isEq: +(k === 12), isC: +(k === 13), isM: +(k === 14), isMR: +(k === 15),
  });

  it('has 18 rules matching the design table', () => {
    expect(RULES.map((r) => r.id)).toEqual(Array.from({ length: 18 }, (_, i) => `R${i + 1}`));
    expect(def.table!.rows).toHaveLength(18);
    expect(STATES).toHaveLength(9);
  });

  it('in every reachable situation exactly one rule fires (none for unused state codes)', () => {
    for (let s = 0; s < 16; s++) {
      for (let k = 0; k < 16; k++) {
        for (const [ready, e, pend] of allInputs(3)) {
          const cls = classOf(k);
          const inputs = [...numberToBits(s, 4), ready, e, pend, ...CONDITIONS.slice(3).map((c) => cls[c as keyof typeof cls])] as Bit[];
          expect(activeRules(inputs).length, `state ${s} key ${k}`).toBe(s < 9 ? 1 : 0);
        }
      }
    }
  });

  it('exhaustive over all 8192 inputs: outputs are the OR of the active rules (unused states → all 0 = IDLE)', () => {
    const names = inputPins(def);
    const outs = outputPins(def);
    for (let v = 0; v < 1 << names.length; v++) {
      const row = numberToBits(v, names.length);
      const expected: Bit[] = new Array(outs.length).fill(0);
      for (const i of activeRules(row)) ruleOutputs(RULES[i]).forEach((b, k) => (expected[k] = (expected[k] | b) as Bit));
      const o = run(sim, Object.fromEntries(names.map((p, i) => [p, row[i]])));
      expect(outs.map((p) => o[p])).toEqual(expected);
    }
  });

  it('rule outputs: X_SRC codes, actions and next state', () => {
    const out = (id: string) => {
      const o = ruleOutputs(RULES.find((r) => r.id === id)!);
      return Object.fromEntries([...SIGNALS, 'n0', 'n1', 'n2', 'n3'].map((s, i) => [s, o[i]]));
    };
    const xsrc = (id: string) => out(id).xsrc0 + 2 * out(id).xsrc1;
    expect(xsrc('R11')).toBe(XSRC.KEY);
    expect(xsrc('R12')).toBe(XSRC.ALU);
    expect(xsrc('R15')).toBe(XSRC.ZERO);
    expect(xsrc('R18')).toBe(XSRC.M);
    expect(out('R13')).toMatchObject({ yload: 1, opload: 1, pendset: 1, xload: 0 });
    const next = (id: string) => out(id).n0 + 2 * out(id).n1 + 4 * out(id).n2 + 8 * out(id).n3;
    expect(next('R6')).toBe(stateCode('EQ_CALC'));
    expect(next('R12')).toBe(stateCode('OP_SAVE'));
    expect(next('R10')).toBe(stateCode('MEM_RECALL'));
    expect(stateCode('MEM_RECALL')).toBe(8);
  });
});

describe('Control unit', () => {
  it('STATE follows NEXT at each tick: a digit key goes IDLE → DIGIT → IDLE', () => {
    const sim = make('ControlUnit');
    const c = sim.circuit;
    const state = () => bitsToNumber([0, 1, 2, 3].map((i) => sim.get(c.pinNet.get(`pla.s${i}`)!)), false);
    run(sim, { ready: 1, isDigit: 1 });
    expect(sim.output('readyclr')).toBe(1);
    expect(sim.output('xload')).toBe(0);
    sim.tick();
    expect(state()).toBe(stateCode('DIGIT'));
    run(sim, { ready: 0 });
    expect(sim.output('xload')).toBe(1);
    sim.tick();
    expect(state()).toBe(stateCode('IDLE'));
    expect(sim.output('xload')).toBe(0);
  });
});

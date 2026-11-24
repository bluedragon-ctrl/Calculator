// Display path (DESIGN.md §4.2): X → display ROM → Err mux → three 7-segment decoders, plus the
// zero detect that drives the "M" indicator.
import { defineComponent, type Library } from '../sim/library';
import type { Bit, ComponentDef, PinDef } from '../sim/types';
import { autoLayout, type AutoNet, type AutoPart } from './autoLayout';
import { CODE_BLANK, CODE_E, CODE_R, DISPLAY_ROM } from './gen/displayRom';
import { minimise, type Term } from './gen/sop';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];
const BITS4 = [0, 1, 2, 3];
const DIGITS = ['h', 't', 'o'] as const;

const bitsOf = (v: number, n: number): Bit[] => Array.from({ length: n }, (_, i) => ((v >> i) & 1) as Bit);

/** Text for a digit code in the ROM table. */
export function codeText(c: number): string {
  if (c <= 9) return String(c);
  if (c === CODE_E) return 'E';
  if (c === CODE_R) return 'r';
  return '·';
}

// --- Display ROM (behavioural, shown as a table) ---
function displayRom(): ComponentDef {
  const pins: Record<string, PinDef> = {};
  BITS.forEach((i) => (pins[`x${i}`] = { dir: 'in', side: 'left', at: 1.5 + i }));
  pins.s = { dir: 'out', side: 'right', at: 1 };
  DIGITS.forEach((d, k) => BITS4.forEach((i) => (pins[`${d}${i}`] = { dir: 'out', side: 'right', at: 2 + k * 4.5 + i })));
  const outBits = (a: number): Bit[] => {
    const r = DISPLAY_ROM[a];
    return [r.sign, ...bitsOf(r.hundreds, 4), ...bitsOf(r.tens, 4), ...bitsOf(r.ones, 4)];
  };
  // One transistor per address bit in each row of the decoder, one per stored 1, plus an
  // inverter (2 transistors) on each of the 13 outputs.
  let ones = 0;
  for (let a = 0; a < 256; a++) ones += outBits(a).filter((b) => b === 1).length;
  const addr = (inputs: readonly Bit[]) => inputs.reduce<number>((v, b, i) => v | (b << i), 0);
  return {
    name: 'DisplayROM',
    title: 'Display ROM',
    blurb: 'A lookup table with one row for each of the 256 values X can hold. Each row says which sign and digits to show.',
    size: [16, 15.5],
    pins,
    behavior: { delay: 2, eval: (inputs) => outBits(addr(inputs)) },
    table: {
      kind: 'rom',
      columns: ['X', 'binary', 'sign', 'hundreds', 'tens', 'ones (· = blank)'],
      ids: DISPLAY_ROM.map((_, a) => String(a)),
      rows: DISPLAY_ROM.map((r, a) => [
        String(a >= 128 ? a - 256 : a),
        a.toString(2).padStart(8, '0'),
        r.sign ? '−' : '',
        codeText(r.hundreds),
        codeText(r.tens),
        codeText(r.ones),
      ]),
      active: (inputs) => [addr(inputs)],
    },
    transistors: 256 * 8 + ones + 13 * 2,
    buses: {
      X: { pins: BITS.map((i) => `x${i}`) },
      hundreds: { pins: BITS4.map((i) => `h${i}`), signed: false },
      tens: { pins: BITS4.map((i) => `t${i}`), signed: false },
      ones: { pins: BITS4.map((i) => `o${i}`), signed: false },
    },
  };
}

// --- Err mux: when E = 1, show "Err" instead of the number ---
// Replacing a bit by a constant needs no full multiplexer: "0 when E" is AND with NOT E, and
// "1 when E" is OR with E. Codes: E = 10 (1010), r = 11 (1011), sign off.
function errMux(lib: Library): ComponentDef {
  const parts: Record<string, AutoPart> = { ne: { type: 'NOT', col: 1, label: 'not E' } };
  const nets: AutoNet[] = [];
  const eSinks = ['ne.a'];
  const neSinks: string[] = [];
  const add = (inp: string, out: string, one: boolean, label: string) => {
    parts[`g_${out}`] = { type: one ? 'OR2' : 'AND2', col: 2, label };
    nets.push({ from: inp, to: [`g_${out}.a`] });
    (one ? eSinks : neSinks).push(`g_${out}.b`);
    nets.push({ from: `g_${out}.y`, to: [out] });
  };
  add('s', 'S', false, 'sign');
  const consts = { h: CODE_E, t: CODE_R, o: CODE_R };
  for (const d of DIGITS) for (const i of BITS4) add(`${d}${i}`, `${d.toUpperCase()}${i}`, ((consts[d] >> i) & 1) === 1, `${d}${i}`);
  nets.push({ from: 'e', to: eSinks, name: 'E' });
  nets.push({ from: 'ne.y', to: neSinks, name: 'not E' });
  const ins = ['s', ...DIGITS.flatMap((d) => BITS4.map((i) => `${d}${i}`))];
  const bus = (p: string) => ({ pins: BITS4.map((i) => `${p}${i}`), signed: false });
  return autoLayout({
    name: 'ErrMux',
    title: 'Err switch',
    blurb: 'Passes the digits through, but when E (error) is 1 it swaps them for the codes that spell "Err".',
    inputs: [...ins, 'e'],
    outputs: ins.map((p) => p.toUpperCase()),
    parts,
    nets,
    innerScale: 2,
    extra: { buses: { h: bus('h'), t: bus('t'), o: bus('o'), H: bus('H'), T: bus('T'), O: bus('O') } },
  }, lib);
}

// --- 7-segment decoder, generated from its truth table ---
/** Segments lit for each code (a top, b upper right, c lower right, d bottom, e lower left, f upper left, g middle). */
export const SEGMENTS: Record<number, string> = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg', 5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg',
  9: 'abcdfg', [CODE_E]: 'adefg', [CODE_R]: 'eg', [CODE_BLANK]: '', 13: '', 14: '', 15: '',
};
export const SEGMENT_NAMES = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;

const termName = (t: Term) => `t${t.mask.toString(16)}${t.value.toString(16)}`;
/** e.g. "1-0-": code bits 3…0, "-" where the bit does not matter. */
const termLabel = (t: Term) => [3, 2, 1, 0].map((i) => ((t.mask >> i) & 1 ? String((t.value >> i) & 1) : '-')).join('');

// Each segment is an OR of AND terms (minimised from the table), built as NAND–NAND:
// one NAND per term, then a NAND over the terms. Segments with more than 4 terms use two
// NANDs and an OR.
function sevenSegDecoder(lib: Library): ComponentDef {
  const parts: Record<string, AutoPart> = {};
  const sinks = new Map<string, string[]>();
  const sink = (sig: string, ref: string) => sinks.set(sig, [...(sinks.get(sig) ?? []), ref]);
  for (const i of [3, 2, 1, 0]) {
    parts[`n${i}`] = { type: 'NOT', col: 1, label: `not ${i}` };
    sink(`v${i}`, `n${i}.a`);
  }
  /** The signal that is 1 when literal (bit i = val) holds, and its inverse. */
  const lit = (i: number, val: number) => (val ? `v${i}` : `n${i}.y`);
  const notLit = (i: number, val: number) => (val ? `n${i}.y` : `v${i}`);
  const outs: { seg: string; drivers: string[] }[] = [];
  const terms = new Map<string, Term>();
  for (const seg of SEGMENT_NAMES) {
    const ones = Object.keys(SEGMENTS).map(Number).filter((c) => SEGMENTS[c].includes(seg));
    // Each entry is the signal that is the INVERSE of a term (a term NAND, or a single inverted literal).
    const inv = minimise(4, ones).map((t) => {
      const used = BITS4.filter((i) => (t.mask >> i) & 1);
      if (used.length === 1) return notLit(used[0], (t.value >> used[0]) & 1);
      terms.set(termName(t), t);
      return `${termName(t)}.y`;
    });
    outs.push({ seg, drivers: inv });
  }
  for (const [name, t] of terms) {
    const used = [3, 2, 1, 0].filter((i) => (t.mask >> i) & 1);
    parts[name] = { type: `NAND${used.length}`, col: 2, label: termLabel(t) };
    used.forEach((i, q) => sink(lit(i, (t.value >> i) & 1), `${name}.${'abcd'[q]}`));
  }
  const nets: AutoNet[] = [];
  for (const { seg, drivers } of outs) {
    const groups = drivers.length > 4 ? [drivers.slice(0, Math.ceil(drivers.length / 2)), drivers.slice(Math.ceil(drivers.length / 2))] : [drivers];
    const groupOut = groups.map((g, k) => {
      const name = groups.length > 1 ? `s${seg}${k}` : `s${seg}`;
      if (g.length === 1) {
        parts[name] = { type: 'NOT', col: 3, label: `segment ${seg}` };
        sink(g[0], `${name}.a`);
      } else {
        parts[name] = { type: `NAND${g.length}`, col: 3, label: `segment ${seg}` };
        g.forEach((d, q) => sink(d, `${name}.${'abcd'[q]}`));
      }
      return `${name}.y`;
    });
    if (groupOut.length === 1) nets.push({ from: groupOut[0], to: [seg], name: `segment ${seg}` });
    else {
      parts[`s${seg}`] = { type: 'OR2', col: 4, label: `segment ${seg}` };
      groupOut.forEach((g, k) => nets.push({ from: g, to: [`s${seg}.${'ab'[k]}`] }));
      nets.push({ from: `s${seg}.y`, to: [seg], name: `segment ${seg}` });
    }
  }
  for (const [sig, to] of sinks) {
    const m = /^n(\d)\.y$/.exec(sig);
    nets.push({ from: sig, to, ...(m ? { name: `not bit ${m[1]}` } : {}) });
  }
  return autoLayout({
    name: 'SevenSegDecoder',
    title: '7-segment decoder',
    blurb: 'Turns a 4-bit digit code into the 7 segments (a to g) that draw that digit. Codes 10 and 11 draw E and r.',
    inputs: ['v0', 'v1', 'v2', 'v3'],
    outputs: [...SEGMENT_NAMES],
    parts,
    nets,
    innerScale: 3,
    outputGap: 2,
    extra: { buses: { code: { pins: ['v0', 'v1', 'v2', 'v3'], signed: false } } },
  }, lib);
}

// --- Zero detect: 1 when all 8 bits are 0 (an 8-input NOR) ---
function zeroDetect8(lib: Library): ComponentDef {
  return autoLayout({
    name: 'ZeroDetect8',
    title: 'Zero detect',
    blurb: 'Gives 1 when all 8 bits are 0, so the number is zero. Two 4-input NOR gates and an AND.',
    inputs: BITS.map((i) => `x${i}`),
    outputs: ['zero'],
    parts: {
      lo: { type: 'NOR4', col: 1, label: 'bits 0-3' },
      hi: { type: 'NOR4', col: 1, label: 'bits 4-7' },
      and: { type: 'AND2', col: 2 },
    },
    nets: [
      ...BITS.map((i) => ({ from: `x${i}`, to: [`${i < 4 ? 'lo' : 'hi'}.${'abcd'[i % 4]}`] })),
      { from: 'lo.y', to: ['and.a'], name: 'bits 0-3 zero' },
      { from: 'hi.y', to: ['and.b'], name: 'bits 4-7 zero' },
      { from: 'and.y', to: ['zero'], name: 'zero' },
    ],
    innerScale: 2,
    extra: { buses: { X: { pins: BITS.map((i) => `x${i}`) } } },
  }, lib);
}

export function defineDisplay(lib: Library): void {
  defineComponent(lib, displayRom());
  defineComponent(lib, errMux(lib));
  defineComponent(lib, sevenSegDecoder(lib));
  defineComponent(lib, zeroDetect8(lib));
}

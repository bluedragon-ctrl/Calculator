// Key input (DESIGN.md §3.1, §4.2, §4.4): keyboard encoder → KEY register + READY flag →
// key class decoder. Built from gates; laid out by the column router (autoLayout).
import { defineComponent, type Library } from '../sim/library';
import type { ComponentDef } from '../sim/types';
import { autoLayout, type AutoNet, type AutoPart } from './autoLayout';

const KEYS = Array.from({ length: 16 }, (_, i) => i);
const BITS4 = [0, 1, 2, 3];

// The encoder turns "which of 16 lines is high" into a 4-bit number. Code bit i is the OR of
// the 8 lines whose number has bit i set (OR8 = two NOR4 + one NAND2), and `pressed` is the OR
// of all 16 lines. The UI only ever drives one line at a time (the key queue), so a plain OR
// encoder is enough (DESIGN.md §11).
function keyEncoder(lib: Library): ComponentDef {
  const parts: Record<string, AutoPart> = {};
  const nets: AutoNet[] = [];
  const sinks = new Map<number, string[]>(KEYS.map((k) => [k, []]));
  // Column 1: for each code bit two NOR4 (the 8 keys with that bit set), then 4 NOR4 for "pressed".
  for (const i of [3, 2, 1, 0]) {
    const keys = KEYS.filter((k) => (k >> i) & 1);
    for (const [half, group] of [['a', keys.slice(0, 4)], ['b', keys.slice(4)]] as const) {
      const name = `o${i}${half}`;
      parts[name] = { type: 'NOR4', col: 1, label: `keys ${group.join(',')}` };
      group.forEach((k, q) => sinks.get(k)!.push(`${name}.${'abcd'[q]}`));
    }
  }
  for (const g of [0, 1, 2, 3]) {
    const name = `p${g}`;
    const group = KEYS.slice(g * 4, g * 4 + 4);
    parts[name] = { type: 'NOR4', col: 1, label: `keys ${group[0]}-${group[3]}` };
    group.forEach((k, q) => sinks.get(k)!.push(`${name}.${'abcd'[q]}`));
  }
  // Column 2: NAND gates finish each OR.
  for (const i of [3, 2, 1, 0]) {
    parts[`c${i}`] = { type: 'NAND2', col: 2, label: `bit ${i}` };
    nets.push({ from: `o${i}a.y`, to: [`c${i}.a`] }, { from: `o${i}b.y`, to: [`c${i}.b`] });
    nets.push({ from: `c${i}.y`, to: [`c${i}`], name: `code bit ${i}` });
  }
  parts.p = { type: 'NAND4', col: 2, label: 'any key' };
  for (const g of [0, 1, 2, 3]) nets.push({ from: `p${g}.y`, to: [`p.${'abcd'[g]}`] });
  nets.push({ from: 'p.y', to: ['pressed'], name: 'pressed' });
  for (const k of KEYS) nets.push({ from: `k${k}`, to: sinks.get(k)!, name: `key line ${k}` });

  return autoLayout({
    name: 'KeyEncoder',
    title: 'Keyboard encoder',
    blurb: 'Turns the one key line that is high into a 4-bit key code, and sets "pressed" when any key is down.',
    inputs: KEYS.map((k) => `k${k}`),
    outputs: ['c0', 'c1', 'c2', 'c3', 'pressed'],
    parts,
    nets,
    innerScale: 3,
    extra: {
      buses: {
        keys: { pins: KEYS.map((k) => `k${k}`), signed: false },
        code: { pins: BITS4.map((i) => `c${i}`), signed: false },
      },
    },
  }, lib);
}

// A flag flip-flop with set and clear: next = set OR (Q AND NOT clear). Used for READY (set by
// a key press, cleared by the control unit) and PEND.
function setClearBit(lib: Library): ComponentDef {
  return autoLayout({
    name: 'SetClearBit',
    title: 'Set/clear flag',
    blurb: 'One flip-flop that remembers a yes/no flag. "set" turns it on at the next tick, "clear" turns it off.',
    inputs: ['set', 'clr', 'clk'],
    outputs: ['q'],
    parts: {
      nclr: { type: 'NOT', col: 1 },
      nset: { type: 'NOT', col: 1 },
      keep: { type: 'NAND2', col: 2, label: 'keep' },
      nx: { type: 'NAND2', col: 3, label: 'next' },
      dff: { type: 'DFF', col: 4 },
    },
    nets: [
      { from: 'clr', to: ['nclr.a'] },
      { from: 'set', to: ['nset.a'] },
      { from: 'clk', to: ['dff.clk'] },
      { from: 'nclr.y', to: ['keep.b'], name: 'not clear' },
      { from: 'nset.y', to: ['nx.a'], name: 'not set' },
      { from: 'keep.y', to: ['nx.b'], name: 'not keep' },
      { from: 'nx.y', to: ['dff.d'], name: 'next' },
      { from: 'dff.q', to: ['q', 'keep.a'], name: 'q' },
    ],
    innerScale: 2,
  }, lib);
}

// KEY register (4 bits, loaded when a key is pressed) and the READY flag.
function keyRegister(lib: Library): ComponentDef {
  const parts: Record<string, AutoPart> = {};
  const nets: AutoNet[] = [];
  for (const i of BITS4) {
    parts[`b${i}`] = { type: 'RegBit', col: 1, label: `bit ${i}` };
    nets.push({ from: `c${i}`, to: [`b${i}.d`] });
    nets.push({ from: `b${i}.q`, to: [`key${i}`], name: `KEY bit ${i}` });
  }
  parts.ready = { type: 'SetClearBit', col: 1, label: 'READY' };
  nets.push({ from: 'pressed', to: [...BITS4.map((i) => `b${i}.load`), 'ready.set'], name: 'pressed' });
  nets.push({ from: 'clk', to: [...BITS4.map((i) => `b${i}.clk`), 'ready.clk'] });
  nets.push({ from: 'rclr', to: ['ready.clr'], name: 'READY_CLR' });
  nets.push({ from: 'ready.q', to: ['ready'], name: 'READY' });
  return autoLayout({
    name: 'KeyRegister',
    title: 'Key register',
    blurb: 'Stores the code of the last key at the clock tick, and sets READY so the control unit knows a key is waiting.',
    inputs: ['c0', 'c1', 'c2', 'c3', 'pressed', 'clk', 'rclr'],
    outputs: ['key0', 'key1', 'key2', 'key3', 'ready'],
    parts,
    nets,
    innerScale: 2,
    extra: {
      buses: {
        code: { pins: BITS4.map((i) => `c${i}`), signed: false },
        KEY: { pins: BITS4.map((i) => `key${i}`), signed: false },
      },
    },
  }, lib);
}

// Sorts the key code into classes: digit (0–9), operator (10, 11), =, C, M, MR.
// Each class is a NOR of the code bits that must be 0 and the inverted bits that must be 1.
function keyClassDecoder(lib: Library): ComponentDef {
  const k = (i: number) => `k${i}`;
  const n = (i: number) => `n${i}.y`;
  return autoLayout({
    name: 'KeyClassDecoder',
    title: 'Key class decoder',
    blurb: 'Looks at the key code and says what kind of key it is: a digit, + or −, =, C, M or MR.',
    inputs: ['k0', 'k1', 'k2', 'k3'],
    outputs: ['isDigit', 'isOp', 'isEq', 'isC', 'isM', 'isMR'],
    parts: {
      n3: { type: 'NOT', col: 1 },
      n2: { type: 'NOT', col: 1 },
      n1: { type: 'NOT', col: 1 },
      n0: { type: 'NOT', col: 1 },
      lo: { type: 'NAND2', col: 2, label: 'bit 2 or 1' },
      op: { type: 'NOR3', col: 2, label: '10, 11' },
      eq: { type: 'NOR4', col: 2, label: '12' },
      c: { type: 'NOR4', col: 2, label: '13' },
      m: { type: 'NOR4', col: 2, label: '14' },
      mr: { type: 'NOR4', col: 2, label: '15' },
      dg: { type: 'NAND2', col: 3, label: '0-9' },
    },
    nets: [
      { from: k(3), to: ['n3.a', 'dg.a'] },
      { from: k(2), to: ['n2.a', 'op.b'] },
      { from: k(1), to: ['n1.a', 'eq.c', 'c.c'] },
      { from: k(0), to: ['n0.a', 'eq.d', 'm.d'] },
      { from: n(3), to: ['op.a', 'eq.a', 'c.a', 'm.a', 'mr.a'], name: 'not bit 3' },
      { from: n(2), to: ['lo.a', 'eq.b', 'c.b', 'm.b', 'mr.b'], name: 'not bit 2' },
      { from: n(1), to: ['lo.b', 'op.c', 'm.c', 'mr.c'], name: 'not bit 1' },
      { from: n(0), to: ['c.d', 'mr.d'], name: 'not bit 0' },
      { from: 'lo.y', to: ['dg.b'], name: 'bit 2 or bit 1' },
      { from: 'dg.y', to: ['isDigit'], name: 'isDigit' },
      { from: 'op.y', to: ['isOp'], name: 'isOp' },
      { from: 'eq.y', to: ['isEq'], name: 'isEq' },
      { from: 'c.y', to: ['isC'], name: 'isC' },
      { from: 'm.y', to: ['isM'], name: 'isM' },
      { from: 'mr.y', to: ['isMR'], name: 'isMR' },
    ],
    innerScale: 3,
    extra: { buses: { KEY: { pins: ['k0', 'k1', 'k2', 'k3'], signed: false } } },
  }, lib);
}

export function defineKeyboard(lib: Library): void {
  defineComponent(lib, keyEncoder(lib));
  defineComponent(lib, setClearBit(lib));
  defineComponent(lib, keyRegister(lib));
  defineComponent(lib, keyClassDecoder(lib));
}

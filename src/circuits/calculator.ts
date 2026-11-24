// The whole calculator chip (DESIGN.md §4.1): key input, control unit, datapath and display.
// Laid out left → right in the order a key press travels.
import { defineComponent, type Library } from '../sim/library';
import type { ComponentDef } from '../sim/types';
import { autoLayout, type AutoNet } from './autoLayout';
import { CONDITIONS, SIGNALS } from './control';
import { SEGMENT_NAMES } from './display';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];
const BITS4 = [0, 1, 2, 3];
const KEYS = Array.from({ length: 16 }, (_, i) => i);
const DIGITS = [['h', 'segH'], ['t', 'segT'], ['o', 'segO']] as const;

/** Top-level output pins: the sign segment, three digits × 7 segments, and the M indicator. */
export const SEGMENT_PINS = ['sg', ...DIGITS.flatMap(([d]) => SEGMENT_NAMES.map((s) => `${d}${s}`))];

function calculator(lib: Library): ComponentDef {
  const nets: AutoNet[] = [];
  const net = (from: string, to: string[], name?: string) => nets.push({ from, to, ...(name ? { name } : {}) });

  for (const k of KEYS) net(`k${k}`, [`enc.k${k}`], `key line ${k}`);
  for (const i of BITS4) net(`enc.c${i}`, [`keyreg.c${i}`], `code bit ${i}`);
  net('enc.pressed', ['keyreg.pressed'], 'pressed');
  net('clk', ['keyreg.clk', 'ctrl.clk', 'flags.clk', 'xreg.clk', 'yreg.clk', 'mreg.clk'], 'clock');

  // KEY → class decoder, X mux (zero-extended), OP flag.
  for (const i of BITS4) net(`keyreg.key${i}`, [`cls.k${i}`, `xmux.a${i}`, ...(i === 0 ? ['flags.key0'] : [])], `KEY bit ${i}`);
  net('const0.y', [...[4, 5, 6, 7].map((i) => `xmux.a${i}`), ...BITS.map((i) => `xmux.d${i}`)], 'zero');

  // Control unit.
  net('keyreg.ready', ['ctrl.ready'], 'READY');
  for (const c of ['isDigit', 'isOp', 'isEq', 'isC', 'isM', 'isMR']) net(`cls.${c}`, [`ctrl.${c}`], c);
  const sinks: Record<string, string[]> = {
    xload: ['xreg.load'], xsrc0: ['xmux.s0'], xsrc1: ['xmux.s1'], yload: ['yreg.load'], mload: ['mreg.load'],
    opload: ['flags.opload'], pendset: ['flags.pendset'], pendclr: ['flags.pendclr'], eload: ['flags.eload'],
    eclr: ['flags.eclr'], readyclr: ['keyreg.rclr'],
  };
  for (const s of SIGNALS) net(`ctrl.${s}`, sinks[s], s === 'xsrc0' ? 'X_SRC bit 0' : s === 'xsrc1' ? 'X_SRC bit 1' : s.toUpperCase());
  net('flags.pend', ['ctrl.pend'], 'PEND');
  net('flags.e', ['ctrl.e', 'err.e'], 'E');
  net('flags.op', ['alu.sub'], 'OP (subtract)');
  void CONDITIONS;

  // Datapath.
  for (const i of BITS) {
    net(`xmux.y${i}`, [`xreg.d${i}`], `X input bit ${i}`);
    net(`xreg.q${i}`, [`yreg.d${i}`, `mreg.d${i}`, `alu.b${i}`, `rom.x${i}`], `X bit ${i}`);
    net(`yreg.q${i}`, [`alu.a${i}`], `Y bit ${i}`);
    net(`mreg.q${i}`, [`xmux.c${i}`, `zd.x${i}`], `M bit ${i}`);
    net(`alu.r${i}`, [`xmux.b${i}`], `ALU bit ${i}`);
  }
  net('alu.v', ['flags.v'], 'V (overflow)');
  net('zd.zero', ['mlamp.a'], 'M is zero');
  net('mlamp.y', ['mInd'], 'M indicator');

  // Display.
  net('rom.s', ['err.s'], 'sign');
  for (const [d, seg] of DIGITS) {
    for (const i of BITS4) {
      net(`rom.${d}${i}`, [`err.${d}${i}`], `${d}${i}`);
      net(`err.${d.toUpperCase()}${i}`, [`${seg}.v${i}`], `${d}${i} shown`);
    }
    for (const s of SEGMENT_NAMES) net(`${seg}.${s}`, [`${d}${s}`], `segment ${d}${s}`);
  }
  net('err.S', ['sg'], 'segment sign');

  return autoLayout({
    name: 'Calculator',
    title: 'Calculator chip',
    blurb: 'The whole calculator: keys come in on the left, the display comes out on the right.',
    inputs: [...KEYS.map((k) => `k${k}`), 'clk'],
    outputs: [...SEGMENT_PINS, 'mInd'],
    parts: {
      enc: { type: 'KeyEncoder', col: 1 },
      keyreg: { type: 'KeyRegister', col: 2, label: 'KEY + READY' },
      cls: { type: 'KeyClassDecoder', col: 3 },
      ctrl: { type: 'ControlUnit', col: 4 },
      const0: { type: 'CONST0', col: 4 },
      flags: { type: 'Flags', col: 5 },
      xmux: { type: 'MUX4x8', col: 5, label: 'X input' },
      xreg: { type: 'Register8', col: 6, label: 'X (display)' },
      yreg: { type: 'Register8', col: 7, label: 'Y (first number)' },
      mreg: { type: 'Register8', col: 7, label: 'M (memory)' },
      alu: { type: 'AddSub8', col: 8, label: 'ALU' },
      zd: { type: 'ZeroDetect8', col: 8, label: 'M = 0?' },
      rom: { type: 'DisplayROM', col: 9 },
      mlamp: { type: 'NOT', col: 9, label: 'M lamp' },
      err: { type: 'ErrMux', col: 10 },
      segH: { type: 'SevenSegDecoder', col: 11, label: 'hundreds' },
      segT: { type: 'SevenSegDecoder', col: 11, label: 'tens' },
      segO: { type: 'SevenSegDecoder', col: 11, label: 'ones' },
    },
    nets,
    innerScale: 1,
    pitch: 0.5,
    gap: 3,
    margin: 3,
  }, lib);
}

export function defineCalculator(lib: Library): void {
  defineComponent(lib, calculator(lib));
}

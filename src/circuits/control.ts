// Control unit (DESIGN.md §4.3): a PLA "rulebook" plus a 4-bit STATE register, and the flag
// registers it drives (OP, PEND, E).
import { defineComponent, type Library } from '../sim/library';
import type { Bit, ComponentDef, PinDef } from '../sim/types';
import { autoLayout, type AutoNet, type AutoPart } from './autoLayout';

/** States, numbered 0–8 in binary in the 4-bit STATE register (DESIGN.md §11). */
export const STATES = ['IDLE', 'DIGIT', 'OP_CALC', 'OP_SAVE', 'EQ_CALC', 'CLR_1', 'CLR_2', 'MEM_STORE', 'MEM_RECALL'] as const;
export type State = (typeof STATES)[number];
export const stateCode = (s: State) => STATES.indexOf(s);

/** Inputs of the PLA besides the state bits, in pin order. */
export const CONDITIONS = ['ready', 'e', 'pend', 'isDigit', 'isOp', 'isEq', 'isC', 'isM', 'isMR'] as const;
export type Condition = (typeof CONDITIONS)[number];

/** Control signals, in pin order (the NEXT state bits follow them). */
export const SIGNALS = ['xload', 'xsrc0', 'xsrc1', 'yload', 'mload', 'opload', 'pendset', 'pendclr', 'eload', 'eclr', 'readyclr'] as const;
export type Signal = (typeof SIGNALS)[number];

/** X_SRC values for the X input mux. */
export const XSRC = { KEY: 0, ALU: 1, M: 2, ZERO: 3 } as const;

export interface Rule {
  id: string;
  state: State;
  /** Required values of conditions (absent = don't care). */
  when: Partial<Record<Condition, Bit>>;
  /** Actions as written in the rulebook. */
  actions: string[];
  next: State;
}

const r = (id: string, state: State, when: Rule['when'], actions: string[], next: State): Rule => ({ id, state, when, actions, next });

/** The rulebook, exactly as in DESIGN.md §4.3. */
export const RULES: Rule[] = [
  r('R1', 'IDLE', { ready: 0 }, [], 'IDLE'),
  r('R2', 'IDLE', { ready: 1, e: 1, isC: 0 }, ['READY_CLR'], 'IDLE'),
  r('R3', 'IDLE', { ready: 1, e: 0, isDigit: 1 }, ['READY_CLR'], 'DIGIT'),
  r('R4', 'IDLE', { ready: 1, e: 0, isOp: 1, pend: 1 }, ['READY_CLR'], 'OP_CALC'),
  r('R5', 'IDLE', { ready: 1, e: 0, isOp: 1, pend: 0 }, ['READY_CLR'], 'OP_SAVE'),
  r('R6', 'IDLE', { ready: 1, e: 0, isEq: 1, pend: 1 }, ['READY_CLR'], 'EQ_CALC'),
  r('R7', 'IDLE', { ready: 1, e: 0, isEq: 1, pend: 0 }, ['READY_CLR'], 'IDLE'),
  r('R8', 'IDLE', { ready: 1, isC: 1 }, ['READY_CLR'], 'CLR_1'),
  r('R9', 'IDLE', { ready: 1, e: 0, isM: 1 }, ['READY_CLR'], 'MEM_STORE'),
  r('R10', 'IDLE', { ready: 1, e: 0, isMR: 1 }, ['READY_CLR'], 'MEM_RECALL'),
  r('R11', 'DIGIT', {}, ['X_LOAD', 'X_SRC=KEY'], 'IDLE'),
  r('R12', 'OP_CALC', {}, ['X_LOAD', 'X_SRC=ALU', 'E_LOAD'], 'OP_SAVE'),
  r('R13', 'OP_SAVE', {}, ['Y_LOAD', 'OP_LOAD', 'PEND_SET'], 'IDLE'),
  r('R14', 'EQ_CALC', {}, ['X_LOAD', 'X_SRC=ALU', 'E_LOAD', 'PEND_CLR'], 'IDLE'),
  r('R15', 'CLR_1', {}, ['X_LOAD', 'X_SRC=ZERO', 'E_CLR', 'PEND_CLR'], 'CLR_2'),
  r('R16', 'CLR_2', {}, ['Y_LOAD'], 'IDLE'),
  r('R17', 'MEM_STORE', {}, ['M_LOAD'], 'IDLE'),
  r('R18', 'MEM_RECALL', {}, ['X_LOAD', 'X_SRC=M'], 'IDLE'),
];

const ACTION_SIGNAL: Record<string, Signal> = {
  X_LOAD: 'xload', Y_LOAD: 'yload', M_LOAD: 'mload', OP_LOAD: 'opload', PEND_SET: 'pendset',
  PEND_CLR: 'pendclr', E_LOAD: 'eload', E_CLR: 'eclr', READY_CLR: 'readyclr',
};

/** Output bits of one rule: control signals, then NEXT[0..3]. */
export function ruleOutputs(rule: Rule): Bit[] {
  const on = new Set<Signal>();
  for (const a of rule.actions) {
    const src = /^X_SRC=(\w+)$/.exec(a);
    if (src) {
      const v = XSRC[src[1] as keyof typeof XSRC];
      if (v & 1) on.add('xsrc0');
      if (v & 2) on.add('xsrc1');
    } else on.add(ACTION_SIGNAL[a]);
  }
  const next = stateCode(rule.next);
  return [...SIGNALS.map((s) => (on.has(s) ? 1 : 0) as Bit), ...[0, 1, 2, 3].map((i) => ((next >> i) & 1) as Bit)];
}

const PLA_INPUTS = ['s0', 's1', 's2', 's3', ...CONDITIONS];
const PLA_OUTPUTS = [...SIGNALS, 'n0', 'n1', 'n2', 'n3'];

/** Does the rule's AND term match these PLA inputs (s0..s3, then the conditions)? */
export function ruleMatches(rule: Rule, inputs: readonly Bit[]): boolean {
  const state = inputs[0] | (inputs[1] << 1) | (inputs[2] << 2) | (inputs[3] << 3);
  if (state !== stateCode(rule.state)) return false;
  return CONDITIONS.every((c, i) => rule.when[c] === undefined || rule.when[c] === inputs[4 + i]);
}

/** Rules active for these PLA inputs. A PLA ORs the outputs of every active rule. */
export function activeRules(inputs: readonly Bit[]): number[] {
  const out: number[] = [];
  RULES.forEach((rule, i) => {
    if (ruleMatches(rule, inputs)) out.push(i);
  });
  return out;
}

const RULE_OUTPUTS = RULES.map(ruleOutputs);

function conditionText(rule: Rule): string {
  const parts = Object.entries(rule.when).map(([c, v]) => (v ? '' : '!') + (c === 'ready' ? 'READY' : c === 'e' ? 'E' : c === 'pend' ? 'PEND' : c));
  return parts.length ? parts.join(' & ') : '—';
}

function pla(): ComponentDef {
  const pins: Record<string, PinDef> = {};
  PLA_INPUTS.forEach((p, i) => (pins[p] = { dir: 'in', side: 'left', at: 1 + i }));
  PLA_OUTPUTS.forEach((p, i) => (pins[p] = { dir: 'out', side: 'right', at: 0.5 + i }));
  // AND plane: one transistor per condition (4 state bits + its conditions) in each rule.
  // OR plane: one per output a rule turns on. Plus a pull-up (2) per rule and output line.
  const andPlane = RULES.reduce((n, rule) => n + 4 + Object.keys(rule.when).length, 0);
  const orPlane = RULE_OUTPUTS.reduce((n, o) => n + o.filter((b) => b === 1).length, 0);
  return {
    name: 'PLA',
    title: 'Control rulebook (PLA)',
    blurb: 'A programmable logic array: each row is a rule "in this state, if these conditions hold, do these actions".',
    size: [30, 16],
    pins,
    behavior: {
      delay: 2,
      eval: (inputs) => {
        const out: Bit[] = new Array(PLA_OUTPUTS.length).fill(0);
        for (const i of activeRules(inputs)) RULE_OUTPUTS[i].forEach((b, k) => (out[k] = (out[k] | b) as Bit));
        return out;
      },
    },
    table: {
      kind: 'pla',
      columns: ['rule', 'state', 'condition', 'actions', 'next'],
      ids: RULES.map((rule) => rule.id),
      rows: RULES.map((rule) => [rule.id, rule.state, conditionText(rule), rule.actions.join(', ') || '—', rule.next]),
      active: activeRules,
    },
    transistors: andPlane + orPlane + (RULES.length + PLA_OUTPUTS.length) * 2,
    buses: {
      STATE: { pins: ['s0', 's1', 's2', 's3'], signed: false },
      NEXT: { pins: ['n0', 'n1', 'n2', 'n3'], signed: false },
    },
  };
}

// The PLA and the STATE register (4 flip-flops): every tick, STATE takes NEXT.
function controlUnit(lib: Library): ComponentDef {
  const parts: Record<string, AutoPart> = { pla: { type: 'PLA', col: 1 } };
  const nets: AutoNet[] = [];
  for (const i of [0, 1, 2, 3]) {
    parts[`st${i}`] = { type: 'DFF', col: 2, label: `STATE bit ${i}` };
    nets.push({ from: `pla.n${i}`, to: [`st${i}.d`], name: `NEXT bit ${i}` });
    nets.push({ from: `st${i}.q`, to: [`pla.s${i}`], name: `STATE bit ${i}` });
  }
  for (const c of CONDITIONS) nets.push({ from: c, to: [`pla.${c}`] });
  for (const s of SIGNALS) nets.push({ from: `pla.${s}`, to: [s], name: s.toUpperCase() });
  nets.push({ from: 'clk', to: [0, 1, 2, 3].map((i) => `st${i}.clk`) });
  return autoLayout({
    name: 'ControlUnit',
    title: 'Control unit',
    blurb: 'The boss of the calculator. Its rulebook looks at the state and the key, and switches the other parts on at each tick.',
    inputs: [...CONDITIONS, 'clk'],
    outputs: [...SIGNALS],
    parts,
    nets,
    innerScale: 1,
  }, lib);
}

// OP (loads KEY bit 0: 0 = add, 1 = subtract), PEND (set/clear) and E:
// E's input is E_CLR ? 0 : (E_LOAD ? V : E), so it loads when E_LOAD or E_CLR, with V AND NOT E_CLR.
function flags(lib: Library): ComponentDef {
  return autoLayout({
    name: 'Flags',
    title: 'Flags',
    blurb: 'Three one-bit registers: OP (add or subtract), PEND (an operation is waiting) and E (error).',
    inputs: ['opload', 'key0', 'pendset', 'pendclr', 'v', 'eload', 'eclr', 'clk'],
    outputs: ['op', 'pend', 'e'],
    parts: {
      neclr: { type: 'NOT', col: 1, label: 'not E_CLR' },
      eld: { type: 'OR2', col: 1, label: 'load E' },
      ed: { type: 'AND2', col: 2, label: 'V unless clear' },
      op: { type: 'RegBit', col: 3, label: 'OP' },
      pend: { type: 'SetClearBit', col: 3, label: 'PEND' },
      e: { type: 'RegBit', col: 3, label: 'E' },
    },
    nets: [
      { from: 'opload', to: ['op.load'], name: 'OP_LOAD' },
      { from: 'key0', to: ['op.d'], name: 'KEY bit 0' },
      { from: 'pendset', to: ['pend.set'], name: 'PEND_SET' },
      { from: 'pendclr', to: ['pend.clr'], name: 'PEND_CLR' },
      { from: 'v', to: ['ed.a'], name: 'V' },
      { from: 'eload', to: ['eld.a'], name: 'E_LOAD' },
      { from: 'eclr', to: ['neclr.a', 'eld.b'], name: 'E_CLR' },
      { from: 'neclr.y', to: ['ed.b'], name: 'not E_CLR' },
      { from: 'eld.y', to: ['e.load'], name: 'load E' },
      { from: 'ed.y', to: ['e.d'], name: 'new E' },
      { from: 'clk', to: ['op.clk', 'pend.clk', 'e.clk'] },
      { from: 'op.q', to: ['op'], name: 'OP' },
      { from: 'pend.q', to: ['pend'], name: 'PEND' },
      { from: 'e.q', to: ['e'], name: 'E' },
    ],
    innerScale: 2,
  }, lib);
}

export function defineControl(lib: Library): void {
  defineComponent(lib, pla());
  defineComponent(lib, controlUnit(lib));
  defineComponent(lib, flags(lib));
}

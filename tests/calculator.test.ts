// The whole calculator (DESIGN.md §9 Phase 4): scenario tests (key sequences → display and
// registers), the §4.5 timeline, the key queue, determinism and the transistor counter.
import { describe, expect, it } from 'vitest';
import { STATES } from '../src/circuits/control';
import { library } from '../src/circuits/library';
import { KEY, Machine, keyCodeFor, segmentChar } from '../src/circuits/machine';
import { SEGMENTS } from '../src/circuits/display';
import { flatten } from '../src/sim/flatten';
import { cmosNetlist } from '../src/sim/switchLevel';
import { transistorCount } from '../src/sim/stats';
import type { Bit } from '../src/sim/types';

const fresh = () => new Machine(library);

function typed(keys: string): Machine {
  const m = fresh();
  m.type(keys);
  return m;
}

describe('scenarios', () => {
  it('powers on showing 0 with every register at 0', () => {
    const m = fresh();
    expect(m.sim.startup.oscillating).toBe(false);
    expect(m.display).toBe('   0');
    expect([m.x, m.y, m.m, m.key, m.ready, m.op, m.pend, m.e, m.state]).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 'IDLE']);
    expect(m.mIndicator).toBe(0);
  });

  it('7 + 9 = → 16', () => {
    const m = typed('7+9=');
    expect(m.display).toBe('  16');
    expect(m.x).toBe(16);
    expect(m.pend).toBe(0);
  });

  it('3 − 5 = → −2 (sign in its own position on the left)', () => {
    const m = typed('3-5=');
    expect(m.display).toBe('-  2');
    expect(m.x).toBe(-2);
  });

  it('9 + 9 + 9 + … overflows to Err; then only C works', () => {
    const m = typed('9');
    let n = 9;
    while (n + 9 <= 127) {
      m.type('+9');
      n += 9;
      expect(m.e).toBe(0);
    }
    m.type('+9+'); // 126 + 9 = 135 does not fit: computed when the next + is pressed
    expect(m.e).toBe(1);
    expect(m.display).toBe(' Err');
    for (const k of '5+=mr-') {
      m.type(k);
      expect(m.display, `after ${k}`).toBe(' Err');
    }
    expect(m.m).toBe(0); // M was ignored too
    m.type('C');
    expect(m.display).toBe('   0');
    expect([m.e, m.pend, m.x, m.y]).toEqual([0, 0, 0, 0]);
    m.type('2+3=');
    expect(m.display).toBe('   5');
  });

  it('overflow below −128 also gives Err, and with = as well as a chained operator', () => {
    const m = typed('0-9');
    for (let i = 0; i < 13; i++) m.type('-9'); // 0 − 9·14 = −126
    m.type('=');
    expect(m.x).toBe(-126);
    m.type('-9=');
    expect(m.display).toBe(' Err');
  });

  it('−128 itself fits and shows all three digits', () => {
    const m = typed('0-9');
    for (let i = 0; i < 13; i++) m.type('-9');
    m.type('-2=');
    expect(m.display).toBe('-128');
    expect(m.e).toBe(0);
  });

  it('127 fits; 127 + 1 is Err', () => {
    const m = fresh();
    m.type('9');
    for (let i = 0; i < 13; i++) m.type('+9'); // 126
    m.type('+1=');
    expect(m.display).toBe(' 127');
    m.type('+1=');
    expect(m.display).toBe(' Err');
  });

  it('C clears X, Y, PEND and E but keeps M', () => {
    const m = typed('4m7+2');
    expect(m.pend).toBe(1);
    m.type('C');
    expect([m.x, m.y, m.pend, m.e, m.m]).toEqual([0, 0, 0, 0, 4]);
    expect(m.display).toBe('   0');
    m.type('=');
    expect(m.display).toBe('   0'); // nothing pending any more
  });

  it('M stores the display, MR recalls it; the M indicator shows memory ≠ 0', () => {
    const m = typed('3+4=m');
    expect(m.m).toBe(7);
    expect(m.mIndicator).toBe(1);
    m.type('C5r');
    expect(m.display).toBe('   7');
    m.type('+r=');
    expect(m.display).toBe('  14');
    m.type('Cm'); // C then M stores 0 = clears memory
    expect(m.m).toBe(0);
    expect(m.mIndicator).toBe(0);
  });

  it('negative numbers in memory', () => {
    const m = typed('2-9=m');
    expect(m.m).toBe(-7);
    expect(m.mIndicator).toBe(1);
    m.type('C1+r=');
    expect(m.display).toBe('-  6');
  });

  it('chaining computes progressively: 3 + 4 + 5 = → 12, 9 − 2 + 1 − 3 = → 5', () => {
    const m = typed('3+4+');
    expect(m.display).toBe('   7'); // the running total shows when the next operator is pressed
    m.type('5=');
    expect(m.display).toBe('  12');
    expect(typed('9-2+1-3=').display).toBe('   5');
  });

  it('the result is the first operand of the next calculation', () => {
    expect(typed('7+9=+4=').display).toBe('  20');
    expect(typed('7+9=-').y).toBe(16);
  });

  it('a digit after a result starts a new number; = without an operation does nothing', () => {
    expect(typed('7+9=5').display).toBe('   5');
    const m = typed('8=');
    expect(m.display).toBe('   8');
    expect(m.state).toBe('IDLE');
  });

  it('3 + = → 6 (accepted quirk, DESIGN.md §3.2)', () => {
    expect(typed('3+=').display).toBe('   6');
  });

  it('the last digit wins (single-digit entry)', () => {
    expect(typed('12+34=').display).toBe('   6');
  });

  it('an operator replaces the pending one only through a calculation: 5 + − 2 = → 8', () => {
    // + then − computes 5 + 5 = 10 (Y ← 10, OP ← subtract), then 10 − 2.
    expect(typed('5+-2=').display).toBe('   8');
  });
});

describe('timeline (DESIGN.md §4.5: 7 + 9 =)', () => {
  it('matches the design tick by tick', () => {
    const m = fresh();
    const rows: string[] = [];
    const press = (code: number) => {
      expect(m.press(code)).not.toBeNull();
    };
    const step = () => {
      m.tick();
      rows.push(`${m.ticks} ${m.state} R${m.ready} X${m.x}`);
    };
    press(7);
    step(); // 1: key captured
    step(); // 2: R3 → DIGIT
    step(); // 3: R11 X ← 7
    press(KEY.PLUS);
    step(); step(); step(); // 4–6
    expect([m.y, m.op, m.pend]).toEqual([7, 0, 1]);
    press(9);
    step(); step(); step(); // 7–9
    press(KEY.EQ);
    step(); // 10
    step(); // 11: R6 → EQ_CALC
    step(); // 12: R14 X ← 16
    expect(rows).toEqual([
      '1 IDLE R1 X0', '2 DIGIT R0 X0', '3 IDLE R0 X7',
      '4 IDLE R1 X7', '5 OP_SAVE R0 X7', '6 IDLE R0 X7',
      '7 IDLE R1 X7', '8 DIGIT R0 X7', '9 IDLE R0 X9',
      '10 IDLE R1 X9', '11 EQ_CALC R0 X9', '12 IDLE R0 X16',
    ]);
    expect(m.busy).toBe(false);
  });

  it('the carry ripples through the adder when X becomes 9 (tick 9), one bit after the other', () => {
    // The ALU adds Y and X all the time, so the sum is ready long before = (DESIGN.md §11).
    const m = typed('7+');
    m.press(9);
    m.tick();
    m.tick();
    const t = m.tick(); // R11: X ← 9
    // When each carry settles: bit after bit, down the chain.
    const settled = (path: string) => Math.max(...t.events.filter((e) => e.net === m.net(path)).map((e) => e.delta));
    const carries = [2, 3, 4].map((i) => settled(`alu.add.fa${i}.cin`));
    for (let i = 1; i < carries.length; i++) expect(carries[i]).toBeGreaterThan(carries[i - 1]);
    // At tick 11 the adder is already settled: only the mux select and X change.
    m.press(KEY.EQ);
    m.tick();
    const t11 = m.tick();
    expect(t11.events.some((e) => e.net === m.net('alu.add.fa1.cin'))).toBe(false);
  });
});

describe('key input', () => {
  it('a key line goes high at once (the encoder reacts) and is released after the next edge', () => {
    const m = fresh();
    const t = m.press(5)!;
    expect(t.events.length).toBeGreaterThan(0);
    expect(m.bit('enc.pressed')).toBe(1);
    expect(m.held).toBe(5);
    expect(m.key).toBe(0); // not captured yet
    m.tick();
    expect(m.key).toBe(5);
    expect(m.held).toBeNull();
    expect(m.bit('enc.pressed')).toBe(0);
  });

  it('keys pressed while busy wait in the queue and are processed in order', () => {
    const m = fresh();
    m.press(7);
    for (const c of [KEY.PLUS, 9, KEY.EQ]) expect(m.press(c)).toBeNull();
    expect(m.queue).toEqual([KEY.PLUS, 9, KEY.EQ]);
    const ticks = m.runUntilIdle();
    expect(m.queue).toEqual([]);
    expect(m.display).toBe('  16');
    expect(ticks).toBe(12);
  });

  it('maps the physical keyboard (DESIGN.md §3.1)', () => {
    expect([...'0123456789'].map(keyCodeFor)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(['+', '-', '=', 'Enter', 'Escape', 'Delete', 'm', 'r'].map(keyCodeFor)).toEqual([10, 11, 12, 12, 13, 13, 14, 15]);
    expect(keyCodeFor('x')).toBeNull();
  });

  it('reads every segment pattern back as its character', () => {
    for (let c = 0; c < 12; c++) {
      const bits = 'abcdefg'.split('').map((s) => (SEGMENTS[c].includes(s) ? 1 : 0)) as Bit[];
      expect(segmentChar(bits)).toBe(c < 10 ? String(c) : c === 10 ? 'E' : 'r');
    }
  });
});

describe('determinism', () => {
  it('the same key sequence gives an identical timeline', () => {
    const record = () => {
      const m = fresh();
      const out: string[] = [];
      for (const k of [3, KEY.MINUS, 5, KEY.EQ, KEY.M, KEY.C, KEY.MR]) {
        m.press(k);
        while (m.busy) {
          const t = m.tick();
          out.push(t.events.map((e) => `${e.net}:${e.value}@${e.delta}`).join(','));
        }
      }
      return out;
    };
    expect(record()).toEqual(record());
  });

  it('never oscillates over a long random session', () => {
    const m = fresh();
    let seed = 11;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      m.press(seed % 16);
      while (m.busy) expect(m.tick().oscillating).toBe(false);
      expect(STATES).toContain(m.state);
    }
  });
});

describe('transistor counter (DESIGN.md §5.6)', () => {
  it('counts gates from their CMOS networks and flip-flops from their structure', () => {
    expect(transistorCount(library.get('NOT'), library)).toBe(2);
    expect(transistorCount(library.get('NAND2'), library)).toBe(4);
    expect(transistorCount(library.get('NAND3'), library)).toBe(6);
    expect(transistorCount(library.get('AND2'), library)).toBe(6);
    expect(transistorCount(library.get('DLatch'), library)).toBe(16);
    expect(transistorCount(library.get('DFF'), library)).toBe(34);
    expect(transistorCount(library.get('CONST0'), library)).toBe(0);
  });

  it('the calculator total = every transistor of its fully structural netlist + the ROM and PLA estimates', () => {
    const c = flatten(library.get('Calculator'), library, { structural: true });
    let n = 0;
    for (const g of c.gates) n += g.def.cmos ? cmosNetlist(g.def.cmos).transistors.length : g.def.transistors ?? 0;
    const total = transistorCount(library.get('Calculator'), library);
    expect(total).toBe(n);
    const tables = (library.get('DisplayROM').transistors ?? 0) + (library.get('PLA').transistors ?? 0);
    expect(tables).toBeGreaterThan(2000);
    expect(total).toBeGreaterThan(tables + 3000);
  });
});

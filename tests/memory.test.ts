// Memory and clock (DESIGN.md §9 Phase 3): latches, flip-flops, registers and tick().
// Sequential parts are tested exhaustively over (stored state × inputs), and the behavioural
// flip-flop is checked against the structural one.
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { definePrimitives } from '../src/circuits/primitives';
import { defineGates } from '../src/circuits/gates';
import { defineRegisters } from '../src/circuits/registers';
import { bitsToNumber, numberToBits } from '../src/sim/bus';
import { flatten, type Circuit } from '../src/sim/flatten';
import { DefinitionError, Library, defineComponent, outputPins } from '../src/sim/library';
import { LocalSim } from '../src/sim/local';
import { CLOCK_HIGH_DELTAS, Simulator } from '../src/sim/simulator';
import type { Bit, ComponentDef } from '../src/sim/types';
import { allInputs } from './helpers';

const BITS = [0, 1, 2, 3, 4, 5, 6, 7];
const make = (name: string, structural = false) => new Simulator(flatten(library.get(name), library, { structural }));

/** Deterministic pseudo-random numbers (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function regValue(sim: Simulator): number {
  return bitsToNumber(BITS.map((i) => sim.output(`q${i}`)), false);
}

function setD(sim: Simulator, v: number, load: Bit): void {
  numberToBits(v, 8).forEach((b, i) => sim.setInput(`d${i}`, b));
  sim.setInput('load', load);
  sim.settle();
}

describe('power-on', () => {
  for (const name of library.names()) {
    it(`${name}: settles without oscillating; memory parts start at Q = 0`, () => {
      for (const structural of [false, true]) {
        const sim = make(name, structural);
        expect(sim.startup.oscillating).toBe(false);
        if (['SRLatch', 'DLatch', 'DFF', 'RegBit', 'Register8'].includes(name)) {
          for (const p of outputPins(library.get(name))) expect(sim.output(p), p).toBe(p === 'qn' ? 1 : 0);
        }
      }
    });
  }

  it('a symmetric cross-coupled latch without powerOn would oscillate (why powerOn exists)', () => {
    const lib = new Library();
    definePrimitives(lib);
    const { powerOn: _, ...bare } = library.get('SRLatch');
    defineComponent(lib, { ...bare, name: 'Bare' });
    expect(new Simulator(flatten(lib.get('Bare'), lib)).startup.oscillating).toBe(true);
  });

  it('rejects powerOn values on nets that do not exist', () => {
    const lib = new Library();
    definePrimitives(lib);
    const bad: ComponentDef = { ...library.get('SRLatch'), name: 'Bad', powerOn: { 'n9.y': 1 } };
    expect(() => defineComponent(lib, bad)).toThrow(DefinitionError);
  });
});

describe('SR latch (NOR)', () => {
  // [S, R] → Q when the latch held `q` before.
  const next = (q: Bit, s: Bit, r: Bit): [Bit, Bit] => {
    if (s && r) return [0, 0]; // not allowed: both outputs 0
    if (s) return [1, 0];
    if (r) return [0, 1];
    return [q, (1 - q) as Bit];
  };

  it('every input from every stored state', () => {
    for (const q0 of [0, 1] as Bit[]) {
      for (const [s, r] of allInputs(2)) {
        const sim = make('SRLatch');
        sim.apply({ s: q0, r: (1 - q0) as Bit }); // store q0
        sim.apply({ s: 0, r: 0 });
        expect(sim.output('q')).toBe(q0);
        const out = sim.apply({ s, r });
        expect([out.q, out.qn], `q0=${q0} s=${s} r=${r}`).toEqual(next(q0, s, r));
        // Back to "hold": it remembers, unless S and R were both 1 (then releasing one decides).
        if (!(s && r)) expect(sim.apply({ s: 0, r: 0 }).q).toBe(next(q0, s, r)[0]);
      }
    }
  });

  it('S = R = 1, then releasing one input leaves a defined state', () => {
    const sim = make('SRLatch');
    sim.apply({ s: 1, r: 1 });
    expect(sim.apply({ s: 0 })).toEqual({ q: 0, qn: 1 });
    sim.apply({ s: 1 });
    expect(sim.apply({ r: 0 })).toEqual({ q: 1, qn: 0 });
  });

  it('set takes two gate delays: the NOR below flips first, then the one above', () => {
    const c = flatten(library.get('SRLatch'), library);
    const sim = new Simulator(c);
    sim.setInput('s', 1);
    const t = sim.settle();
    expect(t.events.map((e) => [c.netNames[e.net], e.value, e.delta])).toEqual([['s', 1, 0], ['qn', 0, 1], ['q', 1, 2]]);
  });
});

describe('D latch', () => {
  it('every input from every stored state: transparent while E = 1, holds while E = 0', () => {
    for (const q0 of [0, 1] as Bit[]) {
      for (const [d, e] of allInputs(2)) {
        const sim = make('DLatch');
        sim.apply({ d: q0, e: 1 });
        sim.apply({ e: 0 });
        sim.apply({ d: (1 - q0) as Bit }); // D changes while closed: no effect
        expect(sim.output('q')).toBe(q0);
        expect(sim.apply({ d, e }).q, `q0=${q0} d=${d} e=${e}`).toBe(e ? d : q0);
        expect(sim.apply({ e: 0, d: (1 - d) as Bit }).q).toBe(e ? d : q0);
      }
    }
  });
});

describe('Simulator.tick()', () => {
  it('a circuit without clock or flip-flops: tick changes nothing', () => {
    const sim = make('XOR2');
    expect(sim.hasClock).toBe(false);
    expect(sim.tick()).toEqual({ events: [], deltas: 0, oscillating: false });
  });

  it('behavioural flip-flops: Q changes at delta 0 with the rising clock, then the clock falls', () => {
    const c = flatten(library.get('RegBit'), library);
    expect(c.gates.filter((g) => g.def.name === 'DFF')).toHaveLength(1);
    const sim = new Simulator(c);
    sim.apply({ d: 1, load: 1 });
    const t = sim.tick();
    const clk = c.inputs.clk;
    const q = c.outputs.q;
    const rise = t.events.filter((e) => e.net !== clk || e.value === 1);
    expect(t.events.find((e) => e.net === clk && e.value === 1)!.delta).toBe(0);
    expect(t.events.find((e) => e.net === q)).toEqual({ net: q, value: 1, delta: 0 });
    const lastRise = Math.max(...rise.map((e) => e.delta));
    const fall = t.events.find((e) => e.net === clk && e.value === 0)!;
    expect(fall.delta).toBe(lastRise + CLOCK_HIGH_DELTAS);
    expect(t.deltas).toBe(fall.delta);
    expect(sim.input('clk')).toBe(0);
    // Deltas never go backwards.
    for (let i = 1; i < t.events.length; i++) expect(t.events[i].delta).toBeGreaterThanOrEqual(t.events[i - 1].delta);
  });

  it('samples D before the edge: a flip-flop feeding its own inverse toggles once per tick', () => {
    const lib = new Library();
    definePrimitives(lib);
    defineGates(lib);
    defineRegisters(lib);
    defineComponent(lib, {
      name: 'Toggle', title: 'Toggle', blurb: '', size: [6, 4],
      pins: { clk: { dir: 'in', side: 'left', at: 2 }, q: { dir: 'out', side: 'right', at: 2 } },
      parts: { ff: { type: 'DFF', at: [8, 1] }, inv: { type: 'NOT', at: [2, 1] } },
      nets: [
        { from: 'clk', to: ['ff.clk'] },
        { from: 'ff.q', to: ['q', 'inv.a'] },
        { from: 'inv.y', to: ['ff.d'] },
      ],
    });
    for (const structural of [false, true]) {
      const sim = new Simulator(flatten(lib.get('Toggle'), lib, { structural }));
      const seen: Bit[] = [];
      for (let i = 0; i < 6; i++) {
        expect(sim.tick().oscillating).toBe(false);
        seen.push(sim.output('q'));
      }
      expect(seen, structural ? 'structural' : 'behavioural').toEqual([1, 0, 1, 0, 1, 0]);
    }
  });

  it('is deterministic', () => {
    const run = () => {
      const sim = make('Register8', true);
      const out = [];
      for (const v of [5, -1, 77]) {
        setD(sim, v, 1);
        out.push(sim.tick());
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});

describe('D flip-flop', () => {
  for (const structural of [true, false]) {
    it(`${structural ? 'structural' : 'behavioural'}: Q changes only at a tick, to the D seen before it`, () => {
      for (const q0 of [0, 1] as Bit[]) {
        for (const d of [0, 1] as Bit[]) {
          const sim = make('DFF', structural);
          sim.apply({ d: q0 });
          sim.tick();
          expect(sim.output('q')).toBe(q0);
          sim.apply({ d });
          expect(sim.output('q'), 'no tick, no change').toBe(q0);
          sim.tick();
          expect(sim.output('q'), `q0=${q0} d=${d}`).toBe(d);
          sim.apply({ d: (1 - d) as Bit });
          expect(sim.output('q'), 'holds after the tick').toBe(d);
        }
      }
    });
  }

  it('the structural flip-flop is two NAND latches and an inverter', () => {
    const types = flatten(library.get('DFF'), library, { structural: true }).gates.map((g) => g.def.name).sort();
    expect(types).toEqual([...Array(8).fill('NAND2'), 'NOT']);
    expect(flatten(library.get('DFF'), library).gates.map((g) => g.def.name)).toEqual(['DFF']);
  });

  it('the structural master follows D while the clock is low; the slave keeps Q', () => {
    const c = flatten(library.get('DFF'), library, { structural: true });
    const sim = new Simulator(c);
    sim.apply({ d: 1 });
    expect(sim.get(c.pinNet.get('master.q')!)).toBe(1);
    expect(sim.output('q')).toBe(0);
  });
});

/** Every sequence of actions up to `len` long, over `actions`. */
function sequences<T>(actions: T[], len: number): T[][] {
  let out: T[][] = [[]];
  const all: T[][] = [];
  for (let i = 0; i < len; i++) {
    out = out.flatMap((s) => actions.map((a) => [...s, a]));
    all.push(...out);
  }
  return all;
}

describe('behavioural and structural flip-flops always agree', () => {
  type Action = 'd0' | 'd1' | 'tick';
  it('DFF: every sequence of up to 7 actions (d = 0, d = 1, tick)', () => {
    for (const seq of sequences<Action>(['d0', 'd1', 'tick'], 7)) {
      const b = make('DFF');
      const s = make('DFF', true);
      for (const a of seq) {
        for (const sim of [b, s]) {
          if (a === 'tick') sim.tick();
          else sim.apply({ d: a === 'd1' ? 1 : 0 });
        }
        expect(b.output('q'), seq.join(' ')).toBe(s.output('q'));
      }
    }
  });

  it('Register8: 400 random steps (D, LOAD, ticks)', () => {
    const r = rng(42);
    const b = make('Register8');
    const s = make('Register8', true);
    for (let i = 0; i < 400; i++) {
      const v = Math.floor(r() * 256);
      const load = (r() < 0.6 ? 1 : 0) as Bit;
      const tick = r() < 0.7;
      for (const sim of [b, s]) {
        setD(sim, v, load);
        if (tick) sim.tick();
      }
      expect(regValue(b), `step ${i}`).toBe(regValue(s));
    }
  });
});

describe('register bit', () => {
  it('every input from every stored state: load picks D, otherwise Q is kept', () => {
    for (const structural of [false, true]) {
      for (const q0 of [0, 1] as Bit[]) {
        for (const [d, load] of allInputs(2)) {
          const sim = make('RegBit', structural);
          sim.apply({ d: q0, load: 1 });
          sim.tick();
          expect(sim.apply({ d, load }).q, 'no change before the tick').toBe(q0);
          sim.tick();
          expect(sim.output('q'), `q0=${q0} d=${d} load=${load}`).toBe(load ? d : q0);
        }
      }
    }
  });
});

describe('8-bit register', () => {
  it('every D and LOAD (all 512 inputs), from several stored values, with behavioural flip-flops', () => {
    const sim = make('Register8');
    for (const stored of [0, 0x55, 0xaa, 0xff, 0x80, 0x01]) {
      for (const [load, ...dBits] of allInputs(9)) {
        setD(sim, stored, 1);
        sim.tick();
        const d = bitsToNumber([...dBits].reverse(), false);
        setD(sim, d, load);
        expect(regValue(sim), 'inputs alone never change Q').toBe(stored);
        sim.tick();
        expect(regValue(sim), `stored=${stored} d=${d} load=${load}`).toBe(load ? d : stored);
      }
    }
  });

  it('structural: loads only on the clock edge with load enabled', () => {
    const sim = make('Register8', true);
    setD(sim, 42, 1);
    expect(regValue(sim)).toBe(0); // no edge yet
    sim.tick();
    expect(regValue(sim)).toBe(42);
    setD(sim, 99, 0);
    sim.tick();
    expect(regValue(sim)).toBe(42); // load off: kept
    setD(sim, 99, 1);
    expect(regValue(sim)).toBe(42); // load on, still no edge
    sim.tick();
    expect(regValue(sim)).toBe(99);
  });

  it('uses one behavioural node per flip-flop in the normal build', () => {
    const c = flatten(library.get('Register8'), library);
    expect(c.gates.filter((g) => g.def.name === 'DFF').map((g) => g.path)).toEqual(BITS.map((i) => `b${i}.dff`));
    expect(c.gateByPath.get('b3.dff')).toBeDefined();
  });
});

describe('local structural copy of a behavioural flip-flop (DESIGN.md §5.2)', () => {
  /** Recorded pin values of instance `path` in the main circuit. */
  const pinsOf = (c: Circuit, sim: Simulator, path: string) => ({
    d: sim.get(c.pinNet.get(`${path}.d`)!),
    clk: sim.get(c.pinNet.get(`${path}.clk`)!),
    q: sim.get(c.pinNet.get(`${path}.q`)!),
  });

  it('starts in the stored state and keeps agreeing when driven by the pins', () => {
    const c = flatten(library.get('Register8'), library);
    const main = new Simulator(c);
    setD(main, 0b1010_0110, 1);
    main.tick();
    const r = rng(7);
    for (const bit of [1, 2, 5]) {
      const path = `b${bit}.dff`;
      const p0 = pinsOf(c, main, path);
      expect(main.stored(c.gateByPath.get(path)!)).toBe(p0.q);
      const local = new LocalSim(library.get('DFF'), library, { d: p0.d, clk: p0.clk }, p0.q);
      expect(local.sim.output('q')).toBe(p0.q);
      for (let i = 0; i < 60; i++) {
        setD(main, Math.floor(r() * 256), (r() < 0.5 ? 1 : 0) as Bit);
        const pins = pinsOf(c, main, path);
        local.drive({ d: pins.d });
        if (r() < 0.6) {
          // Replay the tick at the pins the way the view does: clock up, then down.
          main.tick();
          local.drive({ clk: 1 });
          local.drive({ d: pinsOf(c, main, path).d });
          local.drive({ clk: 0 });
        }
        expect(local.sim.output('q'), `bit ${bit} step ${i}`).toBe(main.output(`q${bit}`));
      }
    }
  });

  it('can start while the clock is high without loading the current D', () => {
    const local = new LocalSim(library.get('DFF'), library, { d: 0, clk: 1 }, 1);
    expect(local.sim.output('q')).toBe(1);
    local.drive({ clk: 0 });
    expect(local.sim.output('q')).toBe(1);
  });
});

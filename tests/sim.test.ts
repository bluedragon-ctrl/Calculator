import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { flatten, pinKey } from '../src/sim/flatten';
import { DefinitionError, Library, defineComponent } from '../src/sim/library';
import { Simulator } from '../src/sim/simulator';
import { definePrimitives } from '../src/circuits/primitives';
import type { ComponentDef } from '../src/sim/types';

const pins2 = {
  a: { dir: 'in', side: 'left', at: 0.5 },
  b: { dir: 'in', side: 'left', at: 1.5 },
  y: { dir: 'out', side: 'right', at: 1 },
} as const;

function freshLib(): Library {
  const lib = new Library();
  definePrimitives(lib);
  return lib;
}

function base(extra: Partial<ComponentDef>): ComponentDef {
  return { name: 'T', title: 'T', blurb: '', size: [3, 2], pins: { ...pins2 }, ...extra };
}

describe('defineComponent validation', () => {
  it('accepts a valid component', () => {
    const lib = freshLib();
    expect(() => defineComponent(lib, base({
      parts: { g: { type: 'NAND2', at: [0, 0] } },
      nets: [{ from: 'a', to: ['g.a'] }, { from: 'b', to: ['g.b'] }, { from: 'g.y', to: ['y'] }],
    }))).not.toThrow();
  });

  const bad: [string, Partial<ComponentDef>, RegExp][] = [
    ['unknown part type', {
      parts: { g: { type: 'NOPE', at: [0, 0] } }, nets: [],
    }, /unknown type/],
    ['unconnected own pin', {
      parts: { g: { type: 'NOT', at: [0, 0] } },
      nets: [{ from: 'a', to: ['g.a'] }, { from: 'g.y', to: ['y'] }],
    }, /pin "b" is not connected/],
    ['unconnected part pin', {
      parts: { g: { type: 'NAND2', at: [0, 0] } },
      nets: [{ from: 'a', to: ['g.a'] }, { from: 'g.y', to: ['y'] }, { from: 'b', to: ['y'] }],
    }, /more than once/],
    ['two drivers on one sink', {
      parts: { g: { type: 'NOT', at: [0, 0] } },
      nets: [{ from: 'a', to: ['g.a'] }, { from: 'b', to: ['g.a'] }, { from: 'g.y', to: ['y'] }],
    }, /more than once/],
    ['sink used as driver', {
      parts: { g: { type: 'NOT', at: [0, 0] } },
      nets: [{ from: 'g.a', to: ['y'] }],
    }, /cannot drive/],
    ['driver used as sink', {
      parts: { g: { type: 'NOT', at: [0, 0] } },
      nets: [{ from: 'a', to: ['g.y'] }],
    }, /is a driver/],
    ['unknown pin', {
      parts: { g: { type: 'NOT', at: [0, 0] } },
      nets: [{ from: 'a', to: ['g.q'] }],
    }, /unknown pin/],
    ['no behaviour or structure', {}, /needs a behavior or a structure/],
  ];
  for (const [label, extra, re] of bad) {
    it(`rejects: ${label}`, () => {
      expect(() => defineComponent(freshLib(), base(extra))).toThrow(DefinitionError);
      expect(() => defineComponent(freshLib(), base(extra))).toThrow(re);
    });
  }

  it('rejects a duplicate name', () => {
    const lib = freshLib();
    expect(() => defineComponent(lib, library.get('NOT'))).toThrow(/already defined/);
  });
});

describe('flatten', () => {
  it('shares one net across hierarchy levels', () => {
    const c = flatten(library.get('XOR2'), library);
    expect(c.gates).toHaveLength(4);
    expect(c.netCount).toBe(6); // a, b, n1, n2, n3, y
    expect(c.pinNet.get(pinKey('n1', 'a'))).toBe(c.inputs.a);
    expect(c.pinNet.get(pinKey('n2', 'a'))).toBe(c.inputs.a);
    expect(c.pinNet.get(pinKey('n4', 'y'))).toBe(c.outputs.y);
    expect(c.driver[c.inputs.a]).toBe(-1);
    expect(c.fanout[c.inputs.a]).toHaveLength(2);
  });
});

describe('timeline', () => {
  it('records each change with its delta (unit delay per gate)', () => {
    const c = flatten(library.get('AND2'), library);
    const sim = new Simulator(c);
    sim.setInput('a', 1);
    expect(sim.settle().events).toEqual([{ net: c.inputs.a, value: 1, delta: 0 }]);
    sim.setInput('b', 1);
    const t = sim.settle();
    const nand = c.pinNet.get('n1.y')!;
    expect(t.events).toEqual([
      { net: c.inputs.b, value: 1, delta: 0 },
      { net: nand, value: 0, delta: 1 },
      { net: c.outputs.y, value: 1, delta: 2 },
    ]);
    expect(t.deltas).toBe(2);
    expect(t.oscillating).toBe(false);
  });

  it('XOR: the longest path is three gate delays, with a visible glitch on n3', () => {
    const c = flatten(library.get('XOR2'), library);
    const sim = new Simulator(c);
    sim.setInput('a', 1);
    expect(sim.settle().deltas).toBe(2); // a → n2 → y
    expect(sim.output('y')).toBe(1);
    sim.setInput('b', 1);
    const t = sim.settle();
    expect(t.deltas).toBe(3); // b → n1 → n2 → y
    expect(sim.output('y')).toBe(0);
    const n3 = c.pinNet.get('n3.y')!;
    expect(t.events.filter((e) => e.net === n3).map((e) => [e.value, e.delta])).toEqual([[0, 1], [1, 2]]);
  });

  it('is deterministic', () => {
    const run = () => {
      const sim = new Simulator(flatten(library.get('XOR2'), library));
      const out = [];
      for (const [a, b] of [[1, 0], [1, 1], [0, 1], [0, 0]] as const) {
        sim.setInput('a', a);
        sim.setInput('b', b);
        out.push(sim.settle());
      }
      return out;
    };
    expect(run()).toEqual(run());
  });

  it('an unchanged input produces an empty timeline', () => {
    const sim = new Simulator(flatten(library.get('NOT'), library));
    sim.setInput('a', 0);
    expect(sim.settle()).toEqual({ events: [], deltas: 0, oscillating: false });
  });

  it('stops an oscillating ring and reports it', () => {
    const lib = freshLib();
    // A NAND with its output fed back to one input: oscillates while `a` = 1.
    defineComponent(lib, {
      name: 'Ring', title: 'Ring', blurb: '', size: [3, 2],
      pins: { a: { dir: 'in', side: 'left', at: 1 }, y: { dir: 'out', side: 'right', at: 1 } },
      parts: { g: { type: 'NAND2', at: [0, 0] }, buf: { type: 'NOT', at: [0, 0] }, buf2: { type: 'NOT', at: [0, 0] } },
      nets: [
        { from: 'a', to: ['g.a'] },
        { from: 'g.y', to: ['buf.a', 'y'] },
        { from: 'buf.y', to: ['buf2.a'] },
        { from: 'buf2.y', to: ['g.b'] },
      ],
    });
    const sim = new Simulator(flatten(lib.get('Ring'), lib));
    sim.setInput('a', 1);
    const t = sim.settle();
    expect(t.oscillating).toBe(true);
    // The simulator is still usable afterwards.
    sim.setInput('a', 0);
    expect(sim.settle().oscillating).toBe(false);
    expect(sim.output('y')).toBe(1);
  });
});

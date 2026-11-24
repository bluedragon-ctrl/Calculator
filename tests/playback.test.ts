import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { Playback, chargeLevel } from '../src/render/playback';
import { flatten } from '../src/sim/flatten';
import { Simulator } from '../src/sim/simulator';

function setup() {
  const c = flatten(library.get('AND2'), library);
  const sim = new Simulator(c);
  const pb = new Playback(Array.from({ length: c.netCount }, (_, i) => sim.get(i)));
  pb.msPerDelta = 100;
  return { c, sim, pb };
}

describe('playback', () => {
  it('each change travels for one delta step, then the next gate follows', () => {
    const { c, sim, pb } = setup();
    sim.setInput('a', 1);
    pb.push(sim.settle());
    pb.finish();
    sim.setInput('b', 1);
    pb.push(sim.settle());
    const nand = c.pinNet.get('n1.y')!;
    const b = c.inputs.b;

    pb.update(50);
    expect(pb.transition(b)).toEqual({ from: 0, to: 1, progress: 0.5 });
    expect(pb.value(b)).toBe(0); // not arrived yet
    expect(pb.transition(nand)).toBeNull();

    pb.update(60); // t = 1.1
    expect(pb.value(b)).toBe(1);
    expect(pb.transition(nand)?.to).toBe(0);
    expect(pb.transition(nand)!.progress).toBeCloseTo(0.1);

    pb.update(200); // t = 3.1
    expect(pb.busy).toBe(false);
    expect(pb.value(c.outputs.y)).toBe(1);
  });

  it('plays a glitch as two changes on the same net', () => {
    const c = flatten(library.get('XOR2'), library);
    const sim = new Simulator(c);
    const pb = new Playback(Array.from({ length: c.netCount }, (_, i) => sim.get(i)));
    sim.setInput('a', 1);
    pb.push(sim.settle());
    pb.finish();
    sim.setInput('b', 1);
    pb.push(sim.settle());
    const n3 = c.pinNet.get('n3.y')!;
    const seen: number[] = [];
    pb.onStart = (net, _from, to) => {
      if (net === n3) seen.push(to);
    };
    pb.finish();
    expect(seen).toEqual([0, 1]);
    expect(pb.value(n3)).toBe(1);
    expect(pb.value(c.outputs.y)).toBe(0);
  });

  it('queues a second timeline after the first, and instant mode applies at once', () => {
    const { c, sim, pb } = setup();
    sim.setInput('a', 1);
    sim.setInput('b', 1);
    pb.push(sim.settle()); // ends at t = 3
    sim.setInput('a', 0);
    pb.push(sim.settle());
    pb.update(250);
    expect(pb.value(c.outputs.y)).toBe(0); // first timeline not finished: y not yet 1
    pb.update(100);
    expect(pb.value(c.outputs.y)).toBe(1);
    expect(pb.value(c.inputs.a)).toBe(1); // second change has not started yet
    pb.msPerDelta = 0;
    pb.update(16);
    expect(pb.value(c.inputs.a)).toBe(0);
    expect(pb.value(c.outputs.y)).toBe(0);
    expect(pb.busy).toBe(false);
  });
});

describe('load capacitor charge', () => {
  it('follows the settled value and charges/drains during a transition', () => {
    expect(chargeLevel(1, null)).toBe(1);
    expect(chargeLevel(0, null)).toBe(0);
    expect(chargeLevel(0, { from: 0, to: 1, progress: 0 })).toBe(0);
    expect(chargeLevel(0, { from: 0, to: 1, progress: 1 })).toBeCloseTo(1);
    const half = chargeLevel(0, { from: 0, to: 1, progress: 0.5 });
    expect(half).toBeGreaterThan(0.5); // fast at first, like charging through a resistor
    expect(chargeLevel(1, { from: 1, to: 0, progress: 0.5 })).toBeCloseTo(1 - half);
  });
});

// NetWires keeps drawn wires in step with the playback, also when it plays instantly.
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { Playback } from '../src/render/playback';
import { NetWires } from '../src/render/views';
import type { Wire } from '../src/render/wires';
import { flatten } from '../src/sim/flatten';
import { Simulator } from '../src/sim/simulator';
import type { Bit } from '../src/sim/types';

function stubWire() {
  const w = { value: 0 as Bit, setValue(v: Bit) { w.value = v; }, setTransition() {}, refresh() {} };
  return w;
}

describe('NetWires', () => {
  it('updates existing wires after an instant change (no transition ever shows)', () => {
    const c = flatten(library.get('DLatch'), library);
    const sim = new Simulator(c);
    const pb = new Playback(Array.from({ length: c.netCount }, (_, i) => sim.get(i)));
    pb.msPerDelta = 0;
    const nets = new NetWires(pb);
    const q = stubWire();
    nets.add(c.outputs.q, q as unknown as Wire);
    expect(q.value).toBe(0);
    sim.setInput('e', 1);
    sim.setInput('d', 1);
    pb.push(sim.settle());
    pb.update(16);
    nets.update();
    expect(q.value).toBe(1);
  });
});

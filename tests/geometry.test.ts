import { describe, expect, it } from 'vitest';
import { cmosLayout, gateLeadEnd } from '../src/circuits/cmosLayout';
import { innerSize, netGeometry, refPos } from '../src/circuits/geometry';
import { GATES } from '../src/circuits/gates';
import { library } from '../src/circuits/library';
import { PRIMITIVES } from '../src/circuits/primitives';
import { inputPins } from '../src/sim/library';
import { cmosNetlist } from '../src/sim/switchLevel';
import type { Point } from '../src/sim/types';

const isOrthogonal = (line: Point[]) =>
  line.every((p, i) => i === 0 || p[0] === line[i - 1][0] || p[1] === line[i - 1][1]);

describe('net geometry', () => {
  for (const def of GATES) {
    it(`${def.name}: every branch is orthogonal, inside the frame, and ends on its sink`, () => {
      const [w, h] = innerSize(def);
      for (const net of def.nets!) {
        const g = netGeometry(def, net, library);
        g.branches.forEach((b, i) => {
          expect(isOrthogonal(b)).toBe(true);
          expect(b[0]).toEqual(refPos(def, net.from, library));
          expect(b[b.length - 1]).toEqual(refPos(def, net.to[i], library));
          for (const [x, y] of b) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(w);
            expect(y).toBeGreaterThanOrEqual(0);
            expect(y).toBeLessThanOrEqual(h);
          }
        });
      }
    });
  }

  it('XOR: the n1 net splits at a junction before n2 and n3', () => {
    const xor = library.get('XOR2');
    const g = netGeometry(xor, xor.nets!.find((n) => n.from === 'n1.y')!, library);
    expect(g.junctions).toEqual([[9.5, 6]]);
  });
});

describe('CMOS layout', () => {
  for (const def of PRIMITIVES) {
    it(`${def.name}: transistors match the netlist and every gate lead is wired`, () => {
      const layout = cmosLayout(def);
      const net = cmosNetlist(def.cmos!);
      expect(layout.fets.map((f) => [f.id, f.type, f.input])).toEqual(net.transistors.map((t) => [t.id, t.type, t.input]));
      const nodes = new Set([...net.nodes, ...inputPins(def).map((p) => `in:${p}`)]);
      for (const w of layout.wires) expect(nodes.has(w.node), w.node).toBe(true);
      for (const f of layout.fets) {
        const lead = layout.wires.find((w) => w.node === `in:${f.input}` && w.points.at(-1)![0] === gateLeadEnd(f) && w.points.at(-1)![1] === f.y);
        expect(lead).toBeDefined();
        expect(f.x).toBeLessThan(layout.width);
        expect(f.y - f.half).toBeGreaterThan(0);
        expect(f.y + f.half).toBeLessThan(layout.height);
      }
      // Every internal node in the netlist is drawn.
      for (const n of net.nodes) expect(layout.wires.some((w) => w.node === n)).toBe(true);
    });
  }
});

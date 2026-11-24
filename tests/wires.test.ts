// Wire state across a travelling change (regression: a wire must keep its new value afterwards).
import { describe, expect, it } from 'vitest';
import { WireMaterials, Wire, pointAlong, polylineLength } from '../src/render/wires';

describe('Wire', () => {
  it('keeps the new value once a change has arrived', () => {
    const w = new Wire([[0, 0], [2, 0]], new WireMaterials());
    w.setTransition({ from: 0, to: 1, progress: 0.5 });
    expect(w.bit).toBe(0);
    // What NetWires does when the change arrives: new settled value, then no transition.
    w.setValue(1);
    w.setTransition(null);
    expect(w.bit).toBe(1);
  });

  it('finds points along a polyline', () => {
    const pts = [[0, 0], [2, 0], [2, 2]] as const;
    const len = polylineLength(pts);
    expect(len).toBe(4);
    expect(pointAlong(pts, len, 0.25)).toEqual({ p: [1, 0], seg: 1 });
    expect(pointAlong(pts, len, 0.75)).toEqual({ p: [2, 1], seg: 2 });
    expect(pointAlong(pts, len, 1).p).toEqual([2, 2]);
  });
});

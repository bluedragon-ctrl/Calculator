// "Schematic | Silicon" toggle (DESIGN.md §6.2a, Phase 4b): flipping it only changes the drawing.
// Values (simulation and playback) and what is open stay exactly the same, and the camera is
// never touched (the toggle has no access to it). Runs the real Bench headless; troika text
// needs a browser, so it is replaced by an empty object here.
import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class extends Object3D {
    text = '';
    fontSize = 1;
    fillOpacity = 1;
    sync() {}
    dispose() {}
  },
}));

const { library } = await import('../src/circuits/library');
const { Bench } = await import('../src/render/bench');
const { WireMaterials } = await import('../src/render/wires');
const { siliconLayout } = await import('../src/circuits/siliconLayout');

const VIEW = { left: -30, right: 30, bottom: -20, top: 20, pxPerWorld: 100 };

function settle(bench: InstanceType<typeof Bench>) {
  for (let i = 0; i < 20; i++) bench.update(1000, VIEW);
}

function snapshot(bench: InstanceType<typeof Bench>) {
  const n = bench.circuit.netCount;
  return {
    sim: Array.from({ length: n }, (_, i) => bench.sim.get(i)),
    shown: Array.from({ length: n }, (_, i) => bench.playback.value(i)),
    expanded: bench.view.isExpanded,
    transistors: bench.view.isTransistorView,
  };
}

describe('silicon toggle', () => {
  for (const name of ['NAND2', 'NOR3', 'NMOS']) {
    it(`${name}: toggling changes the drawing, never the values or what is open`, () => {
      const mode = { on: false };
      const bench = new Bench(library.get(name), library, new WireMaterials(), mode);
      settle(bench);
      expect(bench.view.isTransistorView).toBe(true);
      expect(bench.view.isSiliconView).toBe(false);
      const wires = bench.nets.size;
      for (const pin of bench.inputs) {
        bench.toggle(pin);
        settle(bench);
        const before = snapshot(bench);
        mode.on = true;
        settle(bench);
        expect(bench.view.isSiliconView).toBe(true);
        expect(snapshot(bench)).toEqual(before);
        mode.on = false;
        settle(bench);
        expect(bench.view.isSiliconView).toBe(false);
        expect(snapshot(bench)).toEqual(before);
      }
      // The old drawing's wires were removed: nothing leaks after many toggles.
      expect(bench.nets.size).toBe(wires);
      bench.dispose();
    });
  }

  it('in silicon, hovering finds layers and transistors with their values', () => {
    const mode = { on: true };
    const def = library.get('NAND2');
    const bench = new Bench(def, library, new WireMaterials(), mode);
    bench.setInputs({ a: 1, b: 1 });
    settle(bench);
    const layout = siliconLayout(def);
    // Inner (y-down) layout point → world point, via the box's world bounds.
    const [l, , r, t] = bench.view.worldBounds;
    const k = (r - l) / layout.width;
    const world = ([x, y]: [number, number]) => [l + x * k, t - y * k] as const;
    const centre = (rc: number[]) => [(rc[0] + rc[2]) / 2, (rc[1] + rc[3]) / 2] as [number, number];

    const n1 = layout.regions.find((x) => x.node === 'n1')!;
    const h = bench.hit(...world(centre(n1.rect)), 0.001);
    expect(h).toMatchObject({ kind: 'layer', layer: 'ndiff', node: 'n1', value: 0 });

    const fetA = layout.fets.find((f) => f.type === 'n' && f.input === 'a')!;
    expect(bench.hit(...world(centre(fetA.channel)), 0.001)).toMatchObject({ kind: 'fet', on: true, gate: 1 });
    const fetP = layout.fets.find((f) => f.type === 'p' && f.input === 'b')!;
    expect(bench.hit(...world(centre(fetP.channel)), 0.001)).toMatchObject({ kind: 'fet', on: false, gate: 1 });
    bench.dispose();
  });

  it('the single-transistor bench shows a cross-section whose channel follows the gate', () => {
    for (const [name, onAt] of [['NMOS', 1], ['PMOS', 0]] as const) {
      const bench = new Bench(library.get(name), library, new WireMaterials());
      expect(bench.hasCrossSection).toBe(true);
      const home = bench.homeView(1.6);
      bench.setCrossSection(true);
      // The home view grows to include it.
      expect(bench.homeView(1.6).height).toBeGreaterThan(home.height);
      for (const g of [0, 1] as const) {
        bench.setInputs({ g });
        settle(bench);
        expect(bench.outputValue('out')).toBe(g === onAt ? 1 : 0);
        const [cl, cb, cr, ct] = [-5, -40, 5, -8];
        let hit = null;
        for (let y = ct; y >= cb && !hit; y -= 0.5) {
          for (let x = cl; x <= cr && !hit; x += 0.5) {
            const h = bench.hit(x, y, 0.01);
            if (h?.kind === 'cross') hit = h;
          }
        }
        expect(hit).toMatchObject({ kind: 'cross', on: g === onAt });
      }
      bench.setCrossSection(false);
      expect(bench.crossSectionShown).toBe(false);
      bench.dispose();
    }
    expect(new Bench(library.get('NAND2'), library, new WireMaterials()).hasCrossSection).toBe(false);
  });
});

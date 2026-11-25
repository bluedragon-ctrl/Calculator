// Die floorplan (DESIGN.md §6.2a, Phase 4c): areas to scale with transistor counts, cells that are
// the tested silicon cells, arrays with the real stored bits, and a pad for every chip pin.
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { area, dieLayout, placeCells } from '../src/circuits/dieLayout';
import { siliconLayout } from '../src/circuits/siliconLayout';
import { DISPLAY_ROM } from '../src/circuits/gen/displayRom';
import { transistorCount } from '../src/sim/stats';

const chip = library.get('Calculator');
const layout = dieLayout(chip, library);
const inside = (a: number[], b: number[], eps = 1e-6) =>
  a[0] >= b[0] - eps && a[1] >= b[1] - eps && a[2] <= b[2] + eps && a[3] <= b[3] + eps;
const overlap = (a: number[], b: number[], eps = 1e-6) =>
  a[0] < b[2] - eps && b[0] < a[2] - eps && a[1] < b[3] - eps && b[1] < a[3] - eps;

describe('die floorplan', () => {
  it('has one region per block with transistors, each matching its count', () => {
    const blocks = Object.entries(chip.parts!).filter(([, p]) => transistorCount(library.get(p.type), library) > 0);
    expect(layout.regions.map((r) => r.part).sort()).toEqual(blocks.map(([n]) => n).sort());
    for (const r of layout.regions) {
      expect(r.transistors).toBe(transistorCount(library.get(r.type), library));
    }
    // Only the constant 0 (a wire to ground) has no region.
    expect(Object.keys(chip.parts!).filter((n) => !layout.regions.some((r) => r.part === n))).toEqual(['const0']);
  });

  it('gives every region an area exactly proportional to its transistor count', () => {
    const total = layout.regions.reduce((n, r) => n + r.transistors, 0);
    expect(total).toBe(transistorCount(chip, library));
    for (const r of layout.regions) {
      expect(area(r.rect) / r.transistors).toBeCloseTo(layout.areaPerTransistor, 6);
    }
    expect(layout.regions.reduce((a, r) => a + area(r.rect), 0)).toBeCloseTo(area(layout.core), 6);
  });

  it('keeps regions inside the core and apart from each other', () => {
    expect(inside(layout.core, layout.die)).toBe(true);
    for (const [i, a] of layout.regions.entries()) {
      expect(inside(a.rect, layout.core), a.part).toBe(true);
      for (const b of layout.regions.slice(i + 1)) expect(overlap(a.rect, b.rect), `${a.part}/${b.part}`).toBe(false);
    }
  });

  it('follows the block diagram left → right', () => {
    const x = (part: string) => layout.regions.find((r) => r.part === part)!.rect[0];
    expect(x('enc')).toBeLessThan(x('ctrl'));
    expect(x('ctrl')).toBeLessThan(x('alu'));
    expect(x('alu')).toBeLessThan(x('rom'));
    expect(x('rom')).toBeLessThan(x('segO'));
  });

  it('fills gate blocks with every one of their cells, inside the region and not overlapping', () => {
    for (const r of layout.regions) {
      const cellN = r.cells.reduce((n, c) => n + transistorCount(library.get(c.type), library), 0);
      expect(cellN, r.part).toBe(r.cellTransistors);
      expect(r.cellTransistors + r.arrays.reduce((n, a) => n + a.transistors, 0), r.part).toBe(r.transistors);
      for (const [i, c] of r.cells.entries()) {
        expect(inside(c.rect, r.rect), `${r.part} cell ${i}`).toBe(true);
        const next = r.cells[i + 1];
        if (next) expect(overlap(c.rect, next.rect)).toBe(false);
        // The cell keeps the shape of its silicon layout.
        const l = siliconLayout(library.get(c.type));
        expect((c.rect[2] - c.rect[0]) / (c.rect[3] - c.rect[1])).toBeCloseTo(l.width / l.height, 6);
      }
    }
  });

  it('draws the ROM and the PLA as their stored bits', () => {
    const rom = layout.regions.find((r) => r.part === 'rom')!;
    expect(rom.cells).toHaveLength(0);
    const [arr] = rom.arrays;
    expect(arr.kind).toBe('rom');
    const ones = arr.bits.flat().filter(Boolean).length;
    const expected = DISPLAY_ROM.reduce((n, e) => {
      const bits = [e.sign, e.hundreds, e.tens, e.ones].map((v, i) => (i === 0 ? v : v.toString(2).split('').filter((c) => c === '1').length));
      return n + (bits[0] as number) + (bits[1] as number) + (bits[2] as number) + (bits[3] as number);
    }, 0);
    expect(ones).toBe(expected);
    expect(arr.bits.flat()).toHaveLength(256 * 13);

    const ctrl = layout.regions.find((r) => r.part === 'ctrl')!;
    expect(ctrl.arrays.map((a) => a.kind)).toEqual(['pla']);
    expect(ctrl.cells.length).toBeGreaterThan(0); // the STATE flip-flops
  });

  it('has a pad and a bond wire to the package pin for every chip pin', () => {
    expect(layout.pads.map((p) => p.pin).sort()).toEqual(Object.keys(chip.pins).sort());
    for (const [i, p] of layout.pads.entries()) {
      expect(inside(p.rect, layout.die), p.pin).toBe(true);
      for (const r of layout.regions) expect(overlap(p.rect, r.rect)).toBe(false);
      for (const q of layout.pads.slice(i + 1)) expect(overlap(p.rect, q.rect)).toBe(false);
    }
  });

  it('places cells in rows that wrap', () => {
    const cells = placeCells(['A', 'A', 'A', 'A'], [1, 1, 1, 1], [0, 0, 2.1, 2]);
    expect(new Set(cells.map((c) => c.rect[1])).size).toBe(2);
  });
});

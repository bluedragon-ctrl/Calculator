// Silicon layouts (DESIGN.md §6.2a, Phase 4b). The transistors are *extracted from the masks
// alone*, the way a layout-versus-schematic check works: poly crossing diffusion is a transistor,
// diffusion pieces, poly and metal are conductors, and contacts join metal to what lies below.
// The extracted netlist must equal the CMOS netlist of the same primitive.
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { PRIMITIVES, TRANSISTORS } from '../src/circuits/primitives';
import { siliconLayout, type Rect, type SiliconLayout } from '../src/circuits/siliconLayout';
import { inputPins } from '../src/sim/library';
import { cmosNetlist, GND, OUT, VDD, type CmosNetlist } from '../src/sim/switchLevel';
import type { ComponentDef, Point } from '../src/sim/types';

const EPS = 1e-6;
const overlaps = (a: Rect, b: Rect) => a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS;
const contains = (r: Rect, [x, y]: Point) => x >= r[0] - EPS && x <= r[2] + EPS && y >= r[1] - EPS && y <= r[3] + EPS;
const gap = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b[0] - a[2], a[0] - b[2]), Math.max(0, b[1] - a[3], a[1] - b[3]));
const same = (a: Rect, b: Rect) => a.every((v, i) => Math.abs(v - b[i]) < EPS);

interface Conductor { layer: 'diff' | 'poly' | 'metal'; rect: Rect }
interface Extracted {
  conductors: Conductor[];
  group: number[];
  fets: { type: 'p' | 'n'; channel: Rect; gate: number; terminals: [number, number] }[];
  /** Port name per group root. */
  names: Map<number, string>;
}

function extract(layout: SiliconLayout): Extracted {
  const conductors: Conductor[] = [];
  const fetsRaw: { type: 'p' | 'n'; channel: Rect; poly: number; left: number; right: number }[] = [];
  const polys = layout.shapes.filter((s) => s.layer === 'poly');
  for (const p of polys) conductors.push({ layer: 'poly', rect: p.rect });
  for (const m of layout.shapes.filter((s) => s.layer === 'metal')) conductors.push({ layer: 'metal', rect: m.rect });

  // Diffusion strips split by the poly crossing them.
  for (const strip of layout.shapes.filter((s) => s.layer === 'pdiff' || s.layer === 'ndiff')) {
    const r = strip.rect;
    const crossing = polys.map((p, i) => ({ p, i })).filter(({ p }) => overlaps(p.rect, r));
    for (const { p } of crossing) {
      // A gate must cut the strip completely, or the two sides would still be connected.
      expect(p.rect[1] <= r[1] + EPS && p.rect[3] >= r[3] - EPS, 'poly crosses the whole diffusion').toBe(true);
      expect(p.rect[0] > r[0] + EPS && p.rect[2] < r[2] - EPS, 'diffusion on both sides of a gate').toBe(true);
    }
    crossing.sort((a, b) => a.p.rect[0] - b.p.rect[0]);
    let x = r[0];
    let prev = -1;
    for (const { p, i } of crossing) {
      expect(p.rect[0]).toBeGreaterThan(x + EPS); // no two gates touching
      conductors.push({ layer: 'diff', rect: [x, r[1], p.rect[0], r[3]] });
      const piece = conductors.length - 1;
      if (prev >= 0) fetsRaw[prev].right = piece;
      fetsRaw.push({ type: strip.layer === 'pdiff' ? 'p' : 'n', channel: [p.rect[0], r[1], p.rect[2], r[3]], poly: i, left: piece, right: -1 });
      prev = fetsRaw.length - 1;
      x = p.rect[2];
    }
    conductors.push({ layer: 'diff', rect: [x, r[1], r[2], r[3]] });
    if (prev >= 0) fetsRaw[prev].right = conductors.length - 1;
  }

  // Union-find over conductors.
  const parent = conductors.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => (parent[find(a)] = find(b));
  for (let i = 0; i < conductors.length; i++) {
    for (let j = i + 1; j < conductors.length; j++) {
      const [a, b] = [conductors[i], conductors[j]];
      if (a.layer === b.layer && a.layer !== 'diff' && overlaps(a.rect, b.rect)) union(i, j);
    }
  }
  for (const c of layout.shapes.filter((s) => s.layer === 'contact')) {
    const metal = conductors.flatMap((k, i) => (k.layer === 'metal' && overlaps(k.rect, c.rect) ? [i] : []));
    const below = conductors.flatMap((k, i) => (k.layer !== 'metal' && overlaps(k.rect, c.rect) ? [i] : []));
    expect(metal.length, 'contact under metal').toBeGreaterThan(0);
    // Poly pieces that overlap are already one conductor.
    expect(new Set(below.map(find)).size, 'contact on exactly one diffusion piece or poly').toBe(1);
    expect(below.every((i) => conductors[i].layer === conductors[below[0]].layer)).toBe(true);
    // Never on a channel (a contact there would short the transistor).
    for (const f of fetsRaw) expect(overlaps(f.channel, c.rect)).toBe(false);
    for (const m of metal) union(m, below[0]);
  }
  const group = conductors.map((_, i) => find(i));

  const names = new Map<number, string>();
  for (const port of layout.ports) {
    const hits = new Set(conductors.flatMap((k, i) => (k.layer === 'metal' && contains(k.rect, port.at) ? [group[i]] : [])));
    expect(hits.size, `port ${port.node} touches one conductor`).toBe(1);
    const g = [...hits][0];
    expect(names.get(g), `short between ${names.get(g)} and ${port.node}`).toBeUndefined();
    names.set(g, port.node);
  }
  const polyIndex = (i: number) => conductors.findIndex((k) => k.layer === 'poly' && k.rect === polys[i].rect);
  return {
    conductors, group, names,
    fets: fetsRaw.map((f) => ({ type: f.type, channel: f.channel, gate: group[polyIndex(f.poly)], terminals: [group[f.left], group[f.right]] })),
  };
}

function* permutations<T>(xs: T[]): Generator<T[]> {
  if (xs.length <= 1) {
    yield xs;
    return;
  }
  for (let i = 0; i < xs.length; i++) {
    for (const rest of permutations([...xs.slice(0, i), ...xs.slice(i + 1)])) yield [xs[i], ...rest];
  }
}

const key = (t: { type: string; input: string; a: string; b: string }) => `${t.type}:${t.input}:${[t.a, t.b].sort().join('-')}`;

/** Name every group (ports first, internal nodes by searching the matching renaming). Fails when none matches. */
function matchNetlist(ex: Extracted, net: CmosNetlist): Map<number, string> {
  const gateName = (g: number) => {
    const n = ex.names.get(g);
    expect(n?.startsWith('in:'), 'every gate is driven by an input pin').toBe(true);
    return n!.slice(3);
  };
  const internalGroups = [...new Set(ex.fets.flatMap((f) => f.terminals))].filter((g) => !ex.names.has(g));
  const internalNodes = net.nodes.filter((n) => n !== VDD && n !== GND && n !== OUT);
  expect(internalGroups.length).toBe(internalNodes.length);
  const want = net.transistors.map(key).sort().join();
  for (const perm of permutations(internalNodes)) {
    const names = new Map(ex.names);
    internalGroups.forEach((g, i) => names.set(g, perm[i]));
    const got = ex.fets.map((f) => key({ type: f.type, input: gateName(f.gate), a: names.get(f.terminals[0])!, b: names.get(f.terminals[1])! }));
    if (got.sort().join() === want) return names;
  }
  throw new Error(`extracted transistors do not match the netlist: ${ex.fets.length} found, want ${want}`);
}

const ALL: ComponentDef[] = [...PRIMITIVES, ...TRANSISTORS];

describe('silicon layout', () => {
  for (const def of ALL) {
    describe(def.name, () => {
      const layout = siliconLayout(def);
      const net = cmosNetlist(def.cmos!);

      it('the transistors extracted from the masks match the CMOS netlist', () => {
        const ex = extract(layout);
        expect(ex.fets.length).toBe(net.transistors.length);
        const names = matchNetlist(ex, net);
        // Nothing else is connected to a port by accident: every port is its own group.
        expect(new Set(ex.names.values()).size).toBe(layout.ports.length);
        expect(names.size).toBeGreaterThan(0);
      });

      it('the drawing data agrees with the masks (so the view lights the right pieces)', () => {
        const ex = extract(layout);
        const names = matchNetlist(ex, net);
        const nameOf = (i: number) => names.get(ex.group[i]);
        for (const f of layout.fets) {
          const t = net.transistors[f.id];
          expect([f.type, f.input]).toEqual([t.type, t.input]);
          const e = ex.fets.find((x) => same(x.channel, f.channel))!;
          expect(e, `channel of transistor ${f.id}`).toBeDefined();
          expect(e.terminals.map((g) => names.get(g)).sort()).toEqual([t.a, t.b].sort());
        }
        for (const r of layout.regions) {
          const i = ex.conductors.findIndex((k) => k.layer === 'diff' && same(k.rect, r.rect));
          expect(i, 'region is a diffusion piece').toBeGreaterThanOrEqual(0);
          expect(nameOf(i)).toBe(r.node);
        }
        for (const s of layout.shapes) {
          if (!s.node) continue;
          const i = ex.conductors.findIndex((k) => k.rect === s.rect);
          if (i >= 0) expect(nameOf(i), `${s.layer} tagged ${s.node}`).toBe(s.node);
        }
        // Every point of a signal wire lies on metal of that node.
        for (const w of layout.wires) {
          for (const p of w.points) {
            const on = ex.conductors.some((k, i) => k.layer === 'metal' && contains(k.rect, p) && nameOf(i) === w.node);
            expect(on, `${w.node} wire at ${p}`).toBe(true);
          }
        }
      });

      it('keeps unconnected shapes on a layer apart, and everything inside the frame', () => {
        const ex = extract(layout);
        ex.conductors.forEach((a, i) => {
          for (let j = i + 1; j < ex.conductors.length; j++) {
            const b = ex.conductors[j];
            if (a.layer !== b.layer || a.layer === 'diff' || ex.group[i] === ex.group[j]) continue;
            expect(gap(a.rect, b.rect), `${a.layer} spacing`).toBeGreaterThanOrEqual(0.2);
          }
        });
        const rects = [...layout.shapes.map((s) => s.rect), ...layout.wells];
        for (const [x0, y0, x1, y1] of rects) {
          expect(x0).toBeGreaterThanOrEqual(-EPS);
          expect(y0).toBeGreaterThanOrEqual(-EPS);
          expect(x1).toBeLessThanOrEqual(layout.width + EPS);
          expect(y1).toBeLessThanOrEqual(layout.height + EPS);
        }
        // Row labels fit right of the output connector.
        for (const l of layout.labels.filter((l) => l.kind === 'row')) expect(l.at[0] + 1.7).toBeLessThanOrEqual(layout.width);
      });

      it('the PMOS row is on top inside an n-well, inputs are vertical poly stripes', () => {
        const strips = layout.shapes.filter((s) => s.layer === 'pdiff' || s.layer === 'ndiff');
        if (strips.length === 2) {
          expect(strips[0].layer).toBe('pdiff');
          expect(strips[0].rect[3]).toBeLessThan(strips[1].rect[1]);
        }
        for (const w of layout.wells) {
          const p = strips.find((s) => s.layer === 'pdiff')!;
          expect(w[0] < p.rect[0] && w[1] < p.rect[1] && w[2] > p.rect[2] && w[3] > p.rect[3]).toBe(true);
        }
        const stripes = layout.shapes.filter((s) => s.layer === 'poly' && s.rect[3] - s.rect[1] > 1);
        expect(stripes.map((s) => s.node).sort()).toEqual(inputPins(def).map((p) => `in:${p}`).sort());
        for (const s of stripes) expect(s.rect[3] - s.rect[1]).toBeGreaterThan(s.rect[2] - s.rect[0]);
      });
    });
  }

  it('NAND2: two P transistors share the output piece, the N chain has a middle node without contact', () => {
    const layout = siliconLayout(library.get('NAND2'));
    expect(layout.regions.filter((r) => r.type === 'p').map((r) => r.node)).toEqual([VDD, OUT, VDD]);
    expect(layout.regions.filter((r) => r.type === 'n').map((r) => r.node)).toEqual([OUT, 'n1', GND]);
    const n1 = layout.regions.find((r) => r.node === 'n1')!;
    expect(layout.shapes.some((s) => s.layer === 'contact' && overlaps(s.rect, n1.rect))).toBe(false);
  });

  it('a mask error is caught: moving one contact shorts or opens the cell', () => {
    const layout = siliconLayout(library.get('NOT'));
    // Drop the output contact on the PMOS row: the output is no longer pulled up.
    const broken: SiliconLayout = {
      ...layout,
      shapes: layout.shapes.filter((s) => !(s.layer === 'contact' && s.node === OUT && s.rect[1] < layout.height / 2)),
    };
    expect(() => matchNetlist(extract(broken), cmosNetlist(library.get('NOT').cmos!))).toThrow();
  });
});

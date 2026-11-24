// Sanity checks for every hand-authored layout (DESIGN.md §8.1): parts sit inside the frame
// without overlapping, and wires are orthogonal, never cut through a part, and never run
// along a wire of another net (which would make two signals look like one).
import { describe, expect, it } from 'vitest';
import { library } from '../src/circuits/library';
import { innerSize, netGeometry } from '../src/circuits/geometry';
import type { Point } from '../src/sim/types';

type Rect = [number, number, number, number]; // x0, y0, x1, y1
const EPS = 1e-6;

function partRects(name: string): [string, Rect][] {
  const def = library.get(name);
  return Object.entries(def.parts ?? {}).map(([p, part]) => {
    const [w, h] = library.get(part.type).size;
    return [p, [part.at[0], part.at[1], part.at[0] + w, part.at[1] + h]];
  });
}

const inside = (p: Point, r: Rect, m: number) =>
  p[0] > r[0] + m && p[0] < r[2] - m && p[1] > r[1] + m && p[1] < r[3] - m;

function segments(lines: Point[][]): [Point, Point][] {
  const out: [Point, Point][] = [];
  for (const l of lines) for (let i = 1; i < l.length; i++) out.push([l[i - 1], l[i]]);
  return out;
}

/** Length of the collinear overlap of two axis-aligned segments. */
function overlap([a0, a1]: [Point, Point], [b0, b1]: [Point, Point]): number {
  const horiz = (s0: Point, s1: Point) => Math.abs(s0[1] - s1[1]) < EPS;
  if (horiz(a0, a1) && horiz(b0, b1) && Math.abs(a0[1] - b0[1]) < EPS) {
    return Math.min(Math.max(a0[0], a1[0]), Math.max(b0[0], b1[0])) - Math.max(Math.min(a0[0], a1[0]), Math.min(b0[0], b1[0]));
  }
  if (!horiz(a0, a1) && !horiz(b0, b1) && Math.abs(a0[0] - b0[0]) < EPS) {
    return Math.min(Math.max(a0[1], a1[1]), Math.max(b0[1], b1[1])) - Math.max(Math.min(a0[1], a1[1]), Math.min(b0[1], b1[1]));
  }
  return 0;
}

const composites = library.names().filter((n) => library.get(n).parts);

describe('hand-authored layouts', () => {
  for (const name of composites) {
    const def = library.get(name);
    const [W, H] = innerSize(def);
    const rects = partRects(name);
    const nets = (def.nets ?? []).map((n) => netGeometry(def, n, library));

    it(`${name}: parts are inside the frame and do not overlap`, () => {
      for (const [p, r] of rects) {
        expect(r[0] >= 0 && r[1] >= 0 && r[2] <= W && r[3] <= H, `${p} outside ${W}×${H}`).toBe(true);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const [a, ra] = rects[i];
          const [b, rb] = rects[j];
          const apart = ra[2] <= rb[0] || rb[2] <= ra[0] || ra[3] <= rb[1] || rb[3] <= ra[1];
          expect(apart, `${a} overlaps ${b}`).toBe(true);
        }
      }
    });

    it(`${name}: wires are orthogonal, inside the frame and never cross a part`, () => {
      for (const g of nets) {
        for (const [p0, p1] of segments(g.branches)) {
          const ortho = Math.abs(p0[0] - p1[0]) < EPS || Math.abs(p0[1] - p1[1]) < EPS;
          expect(ortho, `${g.net.from}: diagonal segment`).toBe(true);
          for (let t = 0; t <= 1; t += 0.02) {
            const p: Point = [p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t];
            expect(p[0] >= -EPS && p[0] <= W + EPS && p[1] >= -EPS && p[1] <= H + EPS, `${g.net.from} leaves the frame`).toBe(true);
            for (const [part, r] of rects) {
              expect(inside(p, r, 0.05), `net ${g.net.from} crosses ${part} at ${p}`).toBe(false);
            }
          }
        }
      }
    });

    it(`${name}: different nets never share a stretch of wire`, () => {
      for (let i = 0; i < nets.length; i++) {
        for (let j = i + 1; j < nets.length; j++) {
          for (const a of segments(nets[i].branches)) {
            for (const b of segments(nets[j].branches)) {
              expect(overlap(a, b) > EPS, `${nets[i].net.from} runs along ${nets[j].net.from}`).toBe(false);
            }
          }
        }
      }
    });
  }
});

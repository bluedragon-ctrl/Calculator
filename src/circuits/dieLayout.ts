// Die floorplan of the calculator chip ("real chip" view at chip level, DESIGN.md §6.2a, Phase 4c).
//
// A stylised sketch, honest about sizes:
//   - one region per block of the chip, its area exactly proportional to the block's transistor
//     count (the CONST0 "block" is a wire to ground and has none, so it gets no region);
//   - regions follow the block diagram's columns left → right (keys in on the left, display out
//     on the right), so the die and the block diagram read the same way;
//   - gate blocks are rows of real standard cells: every primitive gate inside the block is its
//     generated silicon cell (the same layout the transistor-level view shows), in the order of
//     the structure, with a routing channel between rows;
//   - ROM and PLA are regular arrays: the grid of their actual stored bits;
//   - bond pads around the edge, and a bond wire from each pad to the package pin it serves.
// Wiring between cells and blocks is not drawn (it would need a real router to be honest).
//
// Coordinates are the chip's inner frame (y down), like every other layout.
import type { Library } from '../sim/library';
import { inputPins } from '../sim/library';
import { transistorCount } from '../sim/stats';
import type { Bit, ComponentDef, Point } from '../sim/types';
import { CONDITIONS, RULES, ruleOutputs, stateCode } from './control';
import { innerScale, pinPos } from './geometry';
import { siliconLayout, type Rect } from './siliconLayout';

/** One standard cell placed in a row: a primitive gate inside the block. */
export interface DieCell {
  /** Primitive type (e.g. `NAND2`); its silicon layout is `siliconLayout(lib.get(type))`. */
  type: string;
  rect: Rect;
}

/** A ROM or PLA drawn as the grid of its stored bits. */
export interface DieArray {
  /** Path of the table part inside the chip (e.g. `ctrl.pla`). */
  path: string;
  kind: 'rom' | 'pla';
  rect: Rect;
  /** bits[row][col]: a transistor where the array stores a 1 (folded to suit the rect). */
  bits: boolean[][];
  transistors: number;
}

export interface DieRegion {
  /** Part name of the block in the chip (e.g. `alu`). */
  part: string;
  type: string;
  rect: Rect;
  transistors: number;
  cells: DieCell[];
  arrays: DieArray[];
  /** Transistors in the cells (the rest are in the arrays). */
  cellTransistors: number;
}

export interface DiePad {
  /** Chip pin this pad serves. */
  pin: string;
  rect: Rect;
  /** Bond wire from the pad to the package pin (the chip box's edge). */
  bond: [Point, Point];
}

export interface DieLayout {
  /** The whole die (silicon), inside the chip box. */
  die: Rect;
  /** The area inside the pad ring that the blocks share. */
  core: Rect;
  regions: DieRegion[];
  pads: DiePad[];
  /** Core area per transistor (every region has exactly this ratio). */
  areaPerTransistor: number;
}

export const area = ([x0, y0, x1, y1]: Rect): number => (x1 - x0) * (y1 - y0);

/** Fraction of a row's height that is cells; the rest is the routing channel above it. */
const ROW_FILL = 0.78;

/** Every primitive gate of a component, in structure order (flip-flops by their structure). */
function collect(def: ComponentDef, lib: Library, path: string, cells: string[], arrays: { path: string; def: ComponentDef }[]): void {
  if (def.cmos) cells.push(def.name);
  else if (def.table) arrays.push({ path, def });
  else for (const [name, p] of Object.entries(def.parts ?? {})) collect(lib.get(p.type), lib, path ? `${path}.${name}` : name, cells, arrays);
}

/** Stored bits of a ROM (one row per address) or PLA (AND plane true/complement lines, then OR plane). */
function arrayBits(def: ComponentDef): boolean[][] {
  if (def.table!.kind === 'rom') {
    const n = inputPins(def).length;
    return Array.from({ length: 2 ** n }, (_, a) => {
      const ins = Array.from({ length: n }, (_, i) => ((a >> i) & 1) as Bit);
      return def.behavior!.eval(ins, 0).map((b) => b === 1);
    });
  }
  return RULES.map((rule) => {
    const code = stateCode(rule.state);
    const and: boolean[] = [];
    for (let i = 0; i < 4; i++) and.push(((code >> i) & 1) === 1, ((code >> i) & 1) === 0);
    for (const c of CONDITIONS) and.push(rule.when[c] === 1, rule.when[c] === 0);
    return [...and, ...ruleOutputs(rule).map((b) => b === 1)];
  });
}

/** Fold a tall array into fewer, wider rows (as real ROMs are) so its shape suits the rect. */
function fold(bits: boolean[][], aspect: number): boolean[][] {
  let best = bits;
  let bestErr = Infinity;
  for (let f = 1; f <= bits.length; f *= 2) {
    if (bits.length % f) break;
    const rows = bits.length / f;
    const cols = bits[0].length * f;
    const err = Math.abs(Math.log(cols / rows / aspect));
    if (err < bestErr) {
      bestErr = err;
      best = Array.from({ length: rows }, (_, r) => Array.from({ length: f }, (_, k) => bits[r + k * rows]).flat());
    }
  }
  return best;
}

/** Place cells (each with width/height ratio `aspects[i]`) in rows filling `rect`. */
export function placeCells(types: string[], aspects: number[], rect: Rect): DieCell[] {
  if (!types.length) return [];
  const [x0, y0, x1, y1] = rect;
  const W = x1 - x0;
  const H = y1 - y0;
  const sum = aspects.reduce((a, b) => a + b, 0);
  let n = Math.max(1, Math.ceil(Math.sqrt((ROW_FILL * H * sum) / (0.92 * W))));
  for (;;) {
    const rowH = H / n;
    const ch = rowH * ROW_FILL;
    const out: DieCell[] = [];
    let row = 0;
    let x = 0;
    let ok = true;
    for (let i = 0; i < types.length; i++) {
      const w = aspects[i] * ch;
      if (x + w > W + 1e-9 && x > 0) {
        row++;
        x = 0;
      }
      if (row >= n || w > W) {
        ok = false;
        break;
      }
      const top = y0 + row * rowH + (rowH - ch);
      out.push({ type: types[i], rect: [x0 + x, top, x0 + x + w, top + ch] });
      x += w;
    }
    if (ok) return out;
    n++;
  }
}

const cellAspect = new Map<string, number>();
function aspectOf(def: ComponentDef): number {
  let a = cellAspect.get(def.name);
  if (a === undefined) {
    const l = siliconLayout(def);
    a = l.width / l.height;
    cellAspect.set(def.name, a);
  }
  return a;
}

export interface BlockPlan {
  cells: DieCell[];
  arrays: DieArray[];
  cellTransistors: number;
}

/**
 * How a block is built, fitted into `rect`: its ROM/PLA arrays on top (each as tall as its share
 * of the transistors), then all its gates as standard cells in rows, each keeping the shape of
 * its silicon layout. Used by the die (one region per block) and by the miniatures on closed
 * composite boxes.
 */
export function blockPlan(def: ComponentDef, lib: Library, rect: Rect, path = '', cache = new Map<string, number>()): BlockPlan {
  const total = transistorCount(def, lib, cache);
  const cells: string[] = [];
  const tables: { path: string; def: ComponentDef }[] = [];
  collect(def, lib, path, cells, tables);
  const [x0, y0, x1, y1] = rect;
  let top = y0;
  const arrays: DieArray[] = tables.map((t) => {
    const n = transistorCount(t.def, lib, cache);
    const ah = ((y1 - y0) * n) / total;
    const r: Rect = [x0, top, x1, top + ah];
    top += ah;
    return { path: t.path, kind: t.def.table!.kind, rect: r, bits: fold(arrayBits(t.def), (x1 - x0) / ah), transistors: n };
  });
  const placed = placeCells(cells, cells.map((t) => aspectOf(lib.get(t))), [x0, top, x1, y1]);
  const cellTransistors = cells.reduce((a, t) => a + transistorCount(lib.get(t), lib, cache), 0);
  return { cells: placed, arrays, cellTransistors };
}

export function dieLayout(def: ComponentDef, lib: Library, cache = new Map<string, number>()): DieLayout {
  if (!def.parts) throw new Error(`${def.name} has no blocks`);
  const s = innerScale(def);
  const [w, h] = [def.size[0] * s, def.size[1] * s];
  const inset = Math.min(w, h) * 0.035;
  const die: Rect = [inset, inset, w - inset, h - inset];
  const ring = Math.min(w, h) * 0.05;
  const core: Rect = [die[0] + ring, die[1] + ring, die[2] - ring, die[3] - ring];

  // Blocks with transistors, grouped into the block diagram's columns.
  const blocks = Object.entries(def.parts)
    .map(([part, p]) => ({ part, p, def: lib.get(p.type), n: transistorCount(lib.get(p.type), lib, cache) }))
    .filter((b) => b.n > 0);
  const total = blocks.reduce((a, b) => a + b.n, 0);
  const columns = new Map<number, typeof blocks>();
  for (const b of blocks) {
    const key = Math.round(b.p.at[0] * 1000);
    columns.set(key, [...(columns.get(key) ?? []), b]);
  }
  const cw = core[2] - core[0];
  const chh = core[3] - core[1];
  const regions: DieRegion[] = [];

  let x = core[0];
  for (const key of [...columns.keys()].sort((a, b) => a - b)) {
    const col = columns.get(key)!.sort((a, b) => a.p.at[1] - b.p.at[1]);
    const colN = col.reduce((a, b) => a + b.n, 0);
    const colW = (cw * colN) / total;
    let y = core[1];
    for (const b of col) {
      const rh = (chh * b.n) / colN;
      const rect: Rect = [x, y, x + colW, y + rh];
      y += rh;
      const plan = blockPlan(b.def, lib, rect, b.part, cache);
      regions.push({ part: b.part, type: b.def.name, rect, transistors: b.n, ...plan });
    }
    x += colW;
  }

  // Bond pads: spread evenly along the die edge nearest to each pin, in pin order.
  const pads: DiePad[] = [];
  const bySide = new Map<string, { pin: string; at: Point }[]>();
  for (const [pin, pd] of Object.entries(def.pins)) {
    const [px, py] = pinPos(def, pd);
    bySide.set(pd.side, [...(bySide.get(pd.side) ?? []), { pin, at: [px * s, py * s] }]);
  }
  for (const [side, list] of bySide) {
    const vertical = side === 'left' || side === 'right';
    list.sort((a, b) => (vertical ? a.at[1] - b.at[1] : a.at[0] - b.at[0]));
    const [lo, hi] = vertical ? [die[1], die[3]] : [die[0], die[2]];
    const span = (hi - lo) * 0.9;
    const step = span / list.length;
    const size = Math.min(ring * 0.6, step * 0.7);
    list.forEach((p, i) => {
      const along = lo + (hi - lo - span) / 2 + step * (i + 0.5);
      const across = side === 'left' ? die[0] + ring / 2 : side === 'right' ? die[2] - ring / 2 : side === 'top' ? die[1] + ring / 2 : die[3] - ring / 2;
      const [cx, cy] = vertical ? [across, along] : [along, across];
      pads.push({ pin: p.pin, rect: [cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2], bond: [[cx, cy], p.at] });
    });
  }

  return { die, core, regions, pads, areaPerTransistor: area(core) / total };
}

// Pure layout geometry for schematics (no rendering imports, so it can be tested headless).
// Inner coordinates have y pointing down; the renderer flips them.
import { splitRef, type Library } from '../sim/library';
import type { ComponentDef, NetDef, PinDef, Point } from '../sim/types';

export const DEFAULT_INNER_SCALE = 6;

export function innerScale(def: ComponentDef): number {
  return def.innerScale ?? DEFAULT_INNER_SCALE;
}

/** Inner frame size (size × innerScale). */
export function innerSize(def: ComponentDef): Point {
  const s = innerScale(def);
  return [def.size[0] * s, def.size[1] * s];
}

/** Pin position in box units, relative to the box's top-left corner. */
export function pinPos(def: ComponentDef, pin: PinDef): Point {
  const [w, h] = def.size;
  switch (pin.side) {
    case 'left': return [0, pin.at];
    case 'right': return [w, pin.at];
    case 'top': return [pin.at, 0];
    case 'bottom': return [pin.at, h];
  }
}

/** Position of a pin reference inside `def`'s inner frame. */
export function refPos(def: ComponentDef, ref: string, lib: Library): Point {
  const { part, pin } = splitRef(ref);
  if (part === null) {
    const [x, y] = pinPos(def, def.pins[pin]);
    const s = innerScale(def);
    return [x * s, y * s];
  }
  const p = def.parts![part];
  const child = lib.get(p.type);
  const [x, y] = pinPos(child, child.pins[pin]);
  return [p.at[0] + x, p.at[1] + y];
}

function sideOf(def: ComponentDef, ref: string, lib: Library): PinDef['side'] {
  const { part, pin } = splitRef(ref);
  if (part === null) return def.pins[pin].side;
  return lib.get(def.parts![part].type).pins[pin].side;
}

const same = (a: Point, b: Point) => Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

/** Orthogonal leg from `from` to a sink at `to`. Horizontal-first, turning just before the sink. */
export function orthoLeg(from: Point, to: Point, sinkSide: PinDef['side']): Point[] {
  const [x0, y0] = from;
  const [x1, y1] = to;
  if (Math.abs(y0 - y1) < 1e-9 || Math.abs(x0 - x1) < 1e-9) return [to];
  if (sinkSide === 'top' || sinkSide === 'bottom') return [[x1, y0], to];
  let xm = x1 - 0.5;
  if (xm <= x0) xm = (x0 + x1) / 2;
  return [[xm, y0], [xm, y1], to];
}

function dedupe(points: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) if (!out.length || !same(out[out.length - 1], p)) out.push(p);
  return out;
}

export interface NetGeometry {
  net: NetDef;
  /** One polyline per sink, each starting at the driver (in `net.to` order). */
  branches: Point[][];
  /** Points where branches split away from each other (excluding the driver itself). */
  junctions: Point[];
}

export function netGeometry(def: ComponentDef, net: NetDef, lib: Library): NetGeometry {
  const start = refPos(def, net.from, lib);
  const branches = net.to.map((sink) => {
    const end = refPos(def, sink, lib);
    const via = net.routes?.[sink] ?? [];
    const last = via.length ? via[via.length - 1] : start;
    return dedupe([start, ...via, ...orthoLeg(last, end, sideOf(def, sink, lib))]);
  });
  const junctions: Point[] = [];
  for (let i = 1; i < branches.length; i++) {
    const j = departurePoint(branches[i], branches.slice(0, i));
    if (j && !same(j, start) && !junctions.some((p) => same(p, j))) junctions.push(j);
  }
  return { net, branches, junctions };
}

function onSegment(p: Point, a: Point, b: Point): boolean {
  const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  if (Math.abs(cross) > 1e-9) return false;
  return p[0] >= Math.min(a[0], b[0]) - 1e-9 && p[0] <= Math.max(a[0], b[0]) + 1e-9
    && p[1] >= Math.min(a[1], b[1]) - 1e-9 && p[1] <= Math.max(a[1], b[1]) + 1e-9;
}

function onPolyline(p: Point, line: Point[]): boolean {
  for (let i = 1; i < line.length; i++) if (onSegment(p, line[i - 1], line[i])) return true;
  return false;
}

/** Where `branch` leaves the earlier branches (null if it never shares anything). */
function departurePoint(branch: Point[], earlier: Point[][]): Point | null {
  const onEarlier = (p: Point) => earlier.some((l) => onPolyline(p, l));
  for (let i = 1; i < branch.length; i++) {
    if (onEarlier(branch[i])) continue;
    // Leaves somewhere on segment i-1 → i: the farthest shared vertex of an earlier branch on it.
    const a = branch[i - 1];
    let best = a;
    let bestD = 0;
    for (const l of earlier) {
      for (const v of l) {
        if (!onSegment(v, a, branch[i])) continue;
        const d = Math.hypot(v[0] - a[0], v[1] - a[1]);
        if (d > bestD && !same(v, branch[i])) {
          best = v;
          bestD = d;
        }
      }
    }
    return onEarlier(best) ? best : null;
  }
  return null;
}

// Gate symbol outlines in box units (y down), drawn when a gate is shown closed.
// Pure geometry, no three.js.
import type { ComponentDef, Point } from '../sim/types';
import { inputPins, outputPins } from '../sim/library';
import { pinPos } from '../circuits/geometry';

export interface SymbolShape {
  /** Closed or open polylines making up the outline. */
  outline: Point[][];
  /** Wire stubs from each pin to the body: [pin name, polyline]. */
  stubs: [string, Point[]][];
  /** Centre for the name label, and a label size that fits the body. */
  labelAt: Point;
  labelSize: number;
}

const BUBBLE_R = 0.13;

function circle(cx: number, cy: number, r: number, n = 20): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Point;
  });
}

function quad(p0: Point, c: Point, p1: Point, n = 14): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    const u = 1 - t;
    return [u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]] as Point;
  });
}

export function gateSymbol(def: ComponentDef): SymbolShape | null {
  if (!def.symbol) return null;
  const [w, h] = def.size;
  const kind = def.symbol;
  const bubble = kind === 'not' || kind === 'nand' || kind === 'nor';
  const m = Math.min(0.2, h * 0.1);
  const by0 = m;
  const by1 = h - m;
  const yc = h / 2;
  const bx0 = kind === 'not' ? 0.3 : 0.5;
  const bx1 = w - (kind === 'not' ? 0.3 : 0.45) - (bubble ? 2 * BUBBLE_R : 0);
  const bw = bx1 - bx0;
  const outline: Point[][] = [];
  // x where an input stub meets the body at height y.
  let backAt = (_y: number): number => bx0;
  let labelX = bx0 + bw * 0.42;

  if (kind === 'and' || kind === 'nand') {
    const xm = bx0 + bw * 0.4;
    const rx = bx1 - xm;
    const ry = (by1 - by0) / 2;
    const arc: Point[] = Array.from({ length: 21 }, (_, i) => {
      const a = -Math.PI / 2 + (i / 20) * Math.PI;
      return [xm + Math.cos(a) * rx, yc + Math.sin(a) * ry] as Point;
    });
    outline.push([[bx0, by1], [bx0, by0], [xm, by0], ...arc, [bx0, by1]]);
  } else if (kind === 'or' || kind === 'nor' || kind === 'xor') {
    const gap = kind === 'xor' ? 0.22 : 0;
    const x0 = bx0 + gap;
    const w2 = bx1 - x0;
    const back = (x: number) => quad([x, by1], [x + w2 * 0.3, yc], [x, by0]);
    outline.push([
      ...quad([x0, by0], [x0 + w2 * 0.6, by0], [bx1, yc]),
      ...quad([bx1, yc], [x0 + w2 * 0.6, by1], [x0, by1]),
      ...back(x0),
    ]);
    if (kind === 'xor') outline.push(back(bx0));
    // The back curve is a quadratic whose y is linear in t, so solve for t directly.
    backAt = (y: number) => {
      const t = (by1 - y) / (by1 - by0);
      return bx0 + 2 * t * (1 - t) * w2 * 0.3;
    };
    labelX = x0 + w2 * 0.42;
  } else if (kind === 'not') {
    outline.push([[bx0, by0], [bx1, yc], [bx0, by1], [bx0, by0]]);
    labelX = bx0 + bw * 0.32;
  }
  if (bubble) outline.push(circle(bx1 + BUBBLE_R, yc, BUBBLE_R));

  const stubs: [string, Point[]][] = [];
  for (const p of inputPins(def)) {
    const [, y] = pinPos(def, def.pins[p]);
    stubs.push([p, [[0, y], [backAt(y), y]]]);
  }
  for (const p of outputPins(def)) {
    const [x, y] = pinPos(def, def.pins[p]);
    stubs.push([p, [[bx1 + (bubble ? 2 * BUBBLE_R : 0), y], [x, y]]]);
  }
  // The NOT triangle narrows quickly, so its label is smaller.
  const labelSize = kind === 'not' ? h * 0.08 : Math.min(0.34, h * 0.17);
  return { outline, stubs, labelAt: [labelX, yc], labelSize };
}

/** Short label drawn inside a gate symbol. */
export function symbolName(def: ComponentDef): string {
  switch (def.symbol) {
    case 'not': return 'NOT';
    case 'and': return 'AND';
    case 'nand': return 'NAND';
    case 'or': return 'OR';
    case 'nor': return 'NOR';
    case 'xor': return 'XOR';
    default: return def.title;
  }
}

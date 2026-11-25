// Generated silicon layouts ("how it looks on the chip", DESIGN.md §6.2a, Phase 4b).
//
// Each CMOS primitive becomes a stylised standard cell, built from the same series/parallel
// description as its transistor schematic:
//   - VDD metal rail on top, GND metal rail at the bottom;
//   - one strip of diffusion per network: the PMOS row on top (inside an n-well), the NMOS row
//     at the bottom;
//   - every input is one vertical polysilicon stripe crossing both rows. Wherever poly crosses
//     diffusion there is a transistor, so one stripe makes that input's P and N transistor;
//   - series transistors share the diffusion between them (that piece is the internal node and
//     has no contact); parallel transistors alternate rail and output pieces, joined by metal;
//   - metal reaches diffusion and poly only through contacts.
//
// Wiring plan (keeps every metal path planar, so no two nodes ever touch):
//   - the output's metal runs in the channel between the rows (one runner under the top row,
//     one above the bottom row), joined by a vertical connector right of the cell;
//   - each input enters on the left, runs down or up a track in the left margin, then along its
//     own lane in the channel to a contact on its poly stripe;
//   - rail contacts are strapped straight up (VDD) or down (GND) to the rails.
//
// Coordinates are the component's inner frame (y down), like the schematics.
import { inputPins, outputPins } from '../sim/library';
import { GND, OUT, VDD } from '../sim/switchLevel';
import type { CmosNet, ComponentDef, Point } from '../sim/types';
import { innerScale, innerSize, pinPos } from './geometry';

export type Layer = 'pdiff' | 'ndiff' | 'poly' | 'metal' | 'contact';
/** Axis-aligned rectangle [x0, y0, x1, y1] with x0 < x1, y0 < y1 (y down). */
export type Rect = [number, number, number, number];

export interface SiliconShape {
  layer: Layer;
  rect: Rect;
  /**
   * What the generator connected this shape to: VDD, GND, OUT, an internal node (p1, n1…) or
   * `in:<pin>`. Diffusion strips have no node (the transistors split them into pieces).
   */
  node?: string;
}

/** A source/drain piece of diffusion between two poly stripes (or at a strip's end). */
export interface SiliconRegion {
  type: 'p' | 'n';
  node: string;
  rect: Rect;
}

export interface SiliconFet {
  /** Same ids as `cmosNetlist` (pull-up first, depth-first order). */
  id: number;
  type: 'p' | 'n';
  input: string;
  /** Where the poly crosses the diffusion: the channel. */
  channel: Rect;
}

/** Centre line of a metal path that carries a signal (an input or the output), for the wire overlay. */
export interface SiliconWire {
  node: string;
  points: Point[];
}

export interface SiliconLayout {
  width: number;
  height: number;
  /** The masks: diffusion strips, poly, metal and contacts. */
  shapes: SiliconShape[];
  /** The n-well around each PMOS row (drawn faintly; not a conductor in this model). */
  wells: Rect[];
  regions: SiliconRegion[];
  fets: SiliconFet[];
  wires: SiliconWire[];
  /** Points where VDD, GND, OUT and the inputs (`in:<pin>`) meet the cell. */
  ports: { node: string; at: Point }[];
  labels: { text: string; at: Point; kind: 'vdd' | 'gnd' | 'row' }[];
}

/** Metal width, contact size, poly width (gate length), and the pitch of lanes and tracks. */
export const METAL_W = 0.5;
export const CONTACT = 0.4;
export const POLY_W = 0.5;
const POLY_PAD = 0.8;
const LANE = 0.9;
const TRACK = 0.9;
/** Rails: centre distance from the frame edge and half height. */
const RAIL_Y = 1;
const RAIL_HALF = 0.5;
/** Distance from a diffusion edge to the runner beside it. */
const RUNNER_GAP = 0.7;
/** Diffusion at a strip's ends, distance between stripes, and how far poly overhangs diffusion. */
const END = 1.3;
const PITCH = 2.4;
const OVERHANG = 0.45;
const WELL_MARGIN = 0.55;
const MAX_DIFF_H = 3.2;
const MIN_DIFF_H = 1.2;
const EPS = 1e-6;

function leaves(net: CmosNet): string[] {
  if (net.kind === 'fet') return [net.input];
  return net.parts.map((p) => {
    if (p.kind !== 'fet') throw new Error('Only flat series/parallel networks are laid out');
    return p.input;
  });
}

/** Metal rectangles along a polyline: one per segment, overlapping at the corners. */
function metalAlong(points: readonly Point[], node: string): SiliconShape[] {
  const h = METAL_W / 2;
  const out: SiliconShape[] = [];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    if (Math.abs(x0 - x1) < EPS && Math.abs(y0 - y1) < EPS) continue;
    out.push({
      layer: 'metal', node,
      rect: [Math.min(x0, x1) - h, Math.min(y0, y1) - h, Math.max(x0, x1) + h, Math.max(y0, y1) + h],
    });
  }
  return out;
}

/** Drop repeated points and points in the middle of straight runs. */
function simplify(points: Point[]): Point[] {
  const p: Point[] = [];
  for (const q of points) {
    const last = p.at(-1);
    if (last && Math.abs(last[0] - q[0]) < EPS && Math.abs(last[1] - q[1]) < EPS) continue;
    p.push(q);
  }
  for (let i = p.length - 2; i >= 1; i--) {
    const [a, b, c] = [p[i - 1], p[i], p[i + 1]];
    if ((Math.abs(a[0] - b[0]) < EPS && Math.abs(b[0] - c[0]) < EPS) || (Math.abs(a[1] - b[1]) < EPS && Math.abs(b[1] - c[1]) < EPS)) {
      p.splice(i, 1);
    }
  }
  return p;
}

const square = (x: number, y: number, size: number): Rect => [x - size / 2, y - size / 2, x + size / 2, y + size / 2];

interface Row {
  type: 'p' | 'n';
  /** Node above and below the network (VDD/OUT for the pull-up, OUT/GND for the pull-down). */
  top: string;
  bottom: string;
  net: CmosNet;
  /** First transistor id of this network in `cmosNetlist`. */
  base: number;
}

export function siliconLayout(def: ComponentDef): SiliconLayout {
  const cmos = def.cmos;
  if (!cmos) throw new Error(`${def.name} has no CMOS structure`);
  const [W, H] = innerSize(def);
  const s = innerScale(def);
  const ins = inputPins(def);
  const yOut = pinPos(def, def.pins[outputPins(def)[0]])[1] * s;

  const rows: Row[] = [{ type: cmos.upType ?? 'p', top: VDD, bottom: OUT, net: cmos.pullUp, base: 0 }];
  if (cmos.pullDown) rows.push({ type: 'n', top: OUT, bottom: GND, net: cmos.pullDown, base: leaves(cmos.pullUp).length });

  // One poly stripe per input. A series chain fixes the order along the diffusion, and both rows
  // share the stripes, so take the order of the series network (any order suits a parallel one).
  const series = rows.filter((r) => r.net.kind === 'series');
  if (series.length > 1 && leaves(series[0].net).join() !== leaves(series[1].net).join()) {
    throw new Error(`${def.name}: two series chains in different orders cannot share poly stripes`);
  }
  const order = leaves((series[0] ?? rows[0]).net);
  const k = order.length;
  for (const r of rows) {
    const l = leaves(r.net);
    if (l.length !== k || [...l].sort().join() !== [...order].sort().join()) {
      throw new Error(`${def.name}: every row needs one transistor per input`);
    }
  }

  // --- Vertical plan: rails, rows and the channel (runners and lanes) ---
  const twoRows = rows.length === 2;
  const channel = twoRows ? 2 * RUNNER_GAP + (k + 1) * LANE : RUNNER_GAP + k * LANE + 0.6;
  const room = H - 2 * (RAIL_Y + RAIL_HALF + 0.6);
  const railEdge = RAIL_Y + RAIL_HALF + 0.6;
  const diffH = Math.min(MAX_DIFF_H, twoRows ? (room - channel) / 2 : yOut - RUNNER_GAP - railEdge - 0.2);
  if (diffH < MIN_DIFF_H) throw new Error(`${def.name}: frame too small for a silicon layout`);
  const stack = (twoRows ? 2 : 1) * diffH + channel;
  // Two rows: centred, so the output (half way down) passes between them. One row: its runner
  // lies level with the output pin, so the output leaves in a straight line.
  const top = twoRows ? H / 2 - stack / 2 : yOut - RUNNER_GAP - diffH;
  if (top < railEdge - EPS || top + stack > H - 0.4) throw new Error(`${def.name}: frame too small for a silicon layout`);
  const rowY: [number, number][] = [[top, top + diffH]];
  const runnerY = [top + diffH + RUNNER_GAP];
  const laneY = order.map((_, i) => runnerY[0] + (i + 1) * LANE);
  if (twoRows) {
    runnerY.push(runnerY[0] + (k + 1) * LANE);
    rowY.push([runnerY[1] + RUNNER_GAP, runnerY[1] + RUNNER_GAP + diffH]);
  }

  // --- Left margin: one track per input (upper pins step left, lower pins step right) ---
  const pinY = new Map(ins.map((p) => [p, pinPos(def, def.pins[p])[1] * s]));
  const lane = new Map(order.map((p, i) => [p, laneY[i]]));
  const upper = order.filter((p) => pinY.get(p)! < lane.get(p)! - EPS);
  const lower = order.filter((p) => pinY.get(p)! > lane.get(p)! + EPS);
  const trackX = new Map<string, number>();
  upper.forEach((p, r) => trackX.set(p, 1 + (upper.length - 1 - r) * TRACK));
  lower.forEach((p, r) => trackX.set(p, 1 + r * TRACK));
  const marginEnd = 1 + Math.max(upper.length, lower.length, 1) * TRACK;

  // --- Horizontal plan: diffusion and stripes, centred in the space left of the output ---
  const diffW = 2 * END + POLY_W + (k - 1) * PITCH;
  const rightRoom = 3.2; // output connector, row labels
  const diffX0 = Math.max(marginEnd + 0.4, (marginEnd + W - rightRoom - diffW) / 2);
  const diffX1 = diffX0 + diffW;
  const xR = diffX1 + 0.9;
  if (xR + 0.5 > W) throw new Error(`${def.name}: frame too narrow for a silicon layout`);
  const stripeX = order.map((_, i) => diffX0 + END + POLY_W / 2 + i * PITCH);
  /** Diffusion piece j of a row: left end, between stripes, right end. */
  const pieceX = (j: number): [number, number] => [
    j === 0 ? diffX0 : stripeX[j - 1] + POLY_W / 2,
    j === k ? diffX1 : stripeX[j] - POLY_W / 2,
  ];

  const shapes: SiliconShape[] = [];
  const regions: SiliconRegion[] = [];
  const fets: SiliconFet[] = [];
  const wires: SiliconWire[] = [];
  const wells: Rect[] = [];
  const labels: SiliconLayout['labels'] = [];
  const counters = { p: 0, n: 0 };
  /** OUT contacts per row (x positions), for the runners. */
  const outContacts: number[][] = rows.map(() => []);

  rows.forEach((row, ri) => {
    const [y0, y1] = rowY[ri];
    shapes.push({ layer: row.type === 'p' ? 'pdiff' : 'ndiff', rect: [diffX0, y0, diffX1, y1] });
    if (row.type === 'p') wells.push([diffX0 - WELL_MARGIN, y0 - WELL_MARGIN, diffX1 + WELL_MARGIN, y1 + WELL_MARGIN]);
    labels.push({ text: row.type === 'p' ? 'PMOS' : 'NMOS', at: [xR + 0.7, (y0 + y1) / 2], kind: 'row' });

    // Nodes of the diffusion pieces, left to right (same internal names as cmosNetlist).
    let nodes: string[];
    if (row.net.kind === 'parallel') nodes = Array.from({ length: k + 1 }, (_, j) => (j % 2 === 0 ? row.top : row.bottom));
    else nodes = [row.top, ...order.slice(1).map(() => `${row.type}${++counters[row.type]}`), row.bottom];

    const declared = leaves(row.net);
    order.forEach((input, i) => {
      fets.push({
        id: row.base + declared.indexOf(input), type: row.type, input,
        channel: [stripeX[i] - POLY_W / 2, y0, stripeX[i] + POLY_W / 2, y1],
      });
    });

    nodes.forEach((node, j) => {
      const [x0, x1] = pieceX(j);
      regions.push({ type: row.type, node, rect: [x0, y0, x1, y1] });
      if (node !== VDD && node !== GND && node !== OUT) return; // internal node: shared diffusion, no contact
      const cx = (x0 + x1) / 2;
      // Rails are reached from the far edge of the row, the output from the channel side.
      const nearTop = node === VDD || (node === OUT && ri === 1);
      const cy = nearTop ? y0 + 0.55 : y1 - 0.55;
      shapes.push({ layer: 'contact', node, rect: square(cx, cy, CONTACT) });
      if (node === VDD) shapes.push(...metalAlong([[cx, cy], [cx, RAIL_Y]], VDD));
      else if (node === GND) shapes.push(...metalAlong([[cx, cy], [cx, H - RAIL_Y]], GND));
      else {
        outContacts[ri].push(cx);
        const strap: Point[] = [[cx, cy], [cx, runnerY[ri]]];
        shapes.push(...metalAlong(strap, OUT));
        wires.push({ node: OUT, points: strap });
      }
    });
    fets.sort((a, b) => a.id - b.id);
  });

  // Poly stripes with a contact pad on each input's lane.
  const polyTop = rowY[0][0] - OVERHANG;
  order.forEach((input, i) => {
    const x = stripeX[i];
    const ly = laneY[i];
    const bottom = Math.max(rowY[rows.length - 1][1] + OVERHANG, ly + POLY_PAD / 2);
    shapes.push({ layer: 'poly', node: `in:${input}`, rect: [x - POLY_W / 2, polyTop, x + POLY_W / 2, bottom] });
    shapes.push({ layer: 'poly', node: `in:${input}`, rect: square(x, ly, POLY_PAD) });
    shapes.push({ layer: 'contact', node: `in:${input}`, rect: square(x, ly, CONTACT) });
    // Pin → margin track → lane → poly contact.
    const py = pinY.get(input)!;
    const tx = trackX.get(input);
    const path = simplify(tx === undefined ? [[0, py], [x, py]] : [[0, py], [tx, py], [tx, ly], [x, ly]]);
    shapes.push(...metalAlong(path, `in:${input}`));
    wires.push({ node: `in:${input}`, points: path });
  });

  // Output: runners under/over the rows, the connector right of the cell, then out to the pin.
  outContacts.forEach((xs, ri) => {
    const run: Point[] = [[Math.min(...xs), runnerY[ri]], [xR, runnerY[ri]]];
    shapes.push(...metalAlong(run, OUT));
    wires.push({ node: OUT, points: run });
  });
  const conn = simplify(twoRows
    ? [[xR, runnerY[0]], [xR, runnerY[1]]]
    : [[xR, runnerY[0]], [xR, yOut]]);
  if (conn.length > 1) {
    shapes.push(...metalAlong(conn, OUT));
    wires.push({ node: OUT, points: conn });
  }
  const outPath: Point[] = [[xR, yOut], [W, yOut]];
  shapes.push(...metalAlong(outPath, OUT));
  wires.push({ node: OUT, points: outPath });

  // Rails.
  shapes.push({ layer: 'metal', node: VDD, rect: [0, RAIL_Y - RAIL_HALF, W, RAIL_Y + RAIL_HALF] });
  labels.push({ text: 'VDD = 1', at: [W - 0.3, RAIL_Y], kind: 'vdd' });
  const ports: SiliconLayout['ports'] = [{ node: VDD, at: [W / 2, RAIL_Y] }];
  if (twoRows) {
    shapes.push({ layer: 'metal', node: GND, rect: [0, H - RAIL_Y - RAIL_HALF, W, H - RAIL_Y + RAIL_HALF] });
    labels.push({ text: 'GND = 0', at: [W - 0.3, H - RAIL_Y], kind: 'gnd' });
    ports.push({ node: GND, at: [W / 2, H - RAIL_Y] });
  }
  ports.push({ node: OUT, at: [W - 0.05, yOut] });
  for (const p of ins) ports.push({ node: `in:${p}`, at: [0.05, pinY.get(p)!] });
  // Pin wires end exactly at the frame edge.
  for (const sh of shapes) {
    const r = sh.rect;
    sh.rect = [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(W, r[2]), Math.min(H, r[3])];
  }

  return { width: W, height: H, shapes, wells, regions, fets, wires, ports, labels };
}

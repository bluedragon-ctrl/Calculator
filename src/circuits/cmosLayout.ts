// Generated transistor schematics for CMOS primitives (DESIGN.md §6.3, §6.2a): VDD rail on top,
// GND rail at the bottom, PMOS pull-up network above the output, NMOS pull-down below, and the
// output's load capacitance hanging from the output to GND.
//
// Transistors use the textbook MOSFET symbol: a gate plate, a channel (drawn broken when the
// transistor is off), drain and source leads that join the channel from the side, and an arrow
// on the source (out of the channel for NMOS, into it for PMOS, which also has a gate bubble).
// A small switch icon beside each transistor repeats its state.
import { inputPins, outputPins } from '../sim/library';
import { GND, OUT, VDD } from '../sim/switchLevel';
import type { CmosNet, ComponentDef, Point } from '../sim/types';
import { innerScale, innerSize, pinPos } from './geometry';

export interface FetLayout {
  /** Same ids as `cmosNetlist` (pull-up first, depth-first order). */
  id: number;
  type: 'p' | 'n';
  input: string;
  /** Channel centre and half length. */
  x: number;
  y: number;
  half: number;
  /** Extra outline shapes: source arrow, PMOS gate bubble. */
  shapes: Point[][];
  /** Switch icon: closed and open blade, plus the fixed contact. */
  switchClosed: Point[];
  switchOpen: Point[];
  switchTicks: Point[];
  /** Where the P/N tag goes (left-aligned, vertically centred). */
  tagAt: Point;
}

export interface CmosWire {
  /** Node name (VDD, GND, OUT, internal p1/n1…) or `in:<pin>` for gate inputs. */
  node: string;
  points: Point[];
  /** Set when this wire is a transistor's own lead (so path highlighting can be exact). */
  fet?: number;
}

/** The output's load capacitance (§6.2a): a faint capacitor from OUT to GND with a charge gauge. */
export interface CapLayout {
  x: number;
  /** Plates: top plate (connected to OUT) and bottom plate (to GND). */
  plateTop: Point[];
  plateBottom: Point[];
  /** Gauge rectangle [x0, y0, x1, y1] (y down); it fills from the bottom as the output charges. */
  gauge: [number, number, number, number];
}

export interface CmosLayout {
  width: number;
  height: number;
  fets: FetLayout[];
  wires: CmosWire[];
  /** Absent on the single-transistor benches (no pull-down, so nothing to discharge it). */
  cap: CapLayout | null;
  labels: { text: string; at: Point }[];
}

export const FET_HALF = 0.7;
/** Horizontal offset from the channel to the gate plate. */
export const GATE_GAP = 0.4;
/** Extra offset for the PMOS inversion bubble. */
export const BUBBLE_R = 0.14;
/** Drain/source leads run this far right of the channel and join it from the side. */
export const LEAD_DX = 0.6;
/** Distance from the channel centre to where the side leads join it. */
export const STUB_DY = FET_HALF * 0.72;
/** Horizontal distance between transistors placed side by side. */
export const FET_DX = 3.2;

export function gateLeadEnd(f: { type: 'p' | 'n'; x: number }): number {
  return f.type === 'p' ? f.x - GATE_GAP - 2 * BUBBLE_R : f.x - GATE_GAP;
}

function circle(cx: number, cy: number, r: number, n = 16): Point[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Point;
  });
}

function fetShapes(type: 'p' | 'n', input: string, id: number, x: number, y: number): FetLayout {
  const shapes: Point[][] = [];
  const ax = x + LEAD_DX * 0.5;
  const a = 0.13;
  if (type === 'n') {
    // Source at the bottom; arrow points out of the channel.
    const ay = y + STUB_DY;
    shapes.push([[ax - a * 0.6, ay - a], [ax + a * 0.6, ay], [ax - a * 0.6, ay + a]]);
  } else {
    // Source at the top; arrow points into the channel. Bubble on the gate.
    const ay = y - STUB_DY;
    shapes.push([[ax + a * 0.6, ay - a], [ax - a * 0.6, ay], [ax + a * 0.6, ay + a]]);
    shapes.push(circle(x - GATE_GAP - BUBBLE_R, y, BUBBLE_R));
  }
  const xi = x + LEAD_DX + 0.45;
  return {
    id, type, input, x, y, half: FET_HALF, shapes,
    switchClosed: [[xi, y + 0.45], [xi, y - 0.45]],
    switchOpen: [[xi, y + 0.45], [xi + 0.4, y - 0.3]],
    switchTicks: [[xi - 0.15, y - 0.45], [xi + 0.15, y - 0.45]],
    tagAt: [xi + 0.6, y],
  };
}

export function cmosLayout(def: ComponentDef): CmosLayout {
  if (!def.cmos) throw new Error(`${def.name} has no CMOS structure`);
  const [W, H] = innerSize(def);
  const s = innerScale(def);
  const ins = inputPins(def);
  const out = def.pins[outputPins(def)[0]];
  const yOut = pinPos(def, out)[1] * s;
  const yVdd = 1;
  const yGnd = H - 1;
  const trackX = (i: number) => 1.2 + i * 0.9;
  const x0 = trackX(ins.length) + 2;

  const fets: FetLayout[] = [];
  const wires: CmosWire[] = [];
  const counters = { p: 0, n: 0 };
  let maxX = x0;
  let maxNX = x0;

  /** Leads of one transistor: from the node above, and to the node below (both via the side stubs). */
  const leads = (id: number, x: number, y: number, top: string, yTop: number, bottom: string, yBottom: number) => {
    const xl = x + LEAD_DX;
    wires.push({ node: top, fet: id, points: [[xl, yTop], [xl, y - STUB_DY], [x, y - STUB_DY]] });
    wires.push({ node: bottom, fet: id, points: [[x, y + STUB_DY], [xl, y + STUB_DY], [xl, yBottom]] });
  };

  const place = (net: CmosNet, top: string, bottom: string, ya: number, yb: number, type: 'p' | 'n') => {
    const leaves = net.kind === 'fet' ? [net] : net.parts;
    if (leaves.some((l) => l.kind !== 'fet')) throw new Error('Only flat series/parallel networks are laid out');
    const inputsOf = leaves.map((l) => (l as { input: string }).input);
    const k = inputsOf.length;
    const step = (yb - ya) / k;
    if (net.kind === 'parallel') {
      inputsOf.forEach((input, j) => {
        const x = x0 + j * FET_DX;
        const y = ya + (j + 0.5) * step; // staggered so gate leads never cross a channel
        const id = fets.length;
        fets.push(fetShapes(type, input, id, x, y));
        leads(id, x, y, top, ya, bottom, yb);
        maxX = Math.max(maxX, x);
        if (type === 'n') maxNX = Math.max(maxNX, x);
      });
      const span = (y: number): Point[] => [[x0 + LEAD_DX, y], [x0 + (k - 1) * FET_DX + LEAD_DX, y]];
      if (top !== VDD) wires.push({ node: top, points: span(ya) });
      if (bottom !== GND) wires.push({ node: bottom, points: span(yb) });
    } else {
      let cur = top;
      let curY = ya;
      inputsOf.forEach((input, i) => {
        const y = ya + (i + 0.5) * step;
        const next = i < k - 1 ? `${type}${++counters[type]}` : bottom;
        // An internal node sits halfway between this transistor and the next one.
        const nextY = i < k - 1 ? y + step / 2 : yb;
        const id = fets.length;
        fets.push(fetShapes(type, input, id, x0, y));
        leads(id, x0, y, cur, curY, next, nextY);
        cur = next;
        curY = nextY;
      });
    }
  };

  const { pullUp, pullDown, upType } = def.cmos;
  place(pullUp, VDD, OUT, yVdd, yOut, upType ?? 'p');
  if (pullDown) place(pullDown, OUT, GND, yOut, yGnd, 'n');

  // Load capacitance: right of the pull-down network, from OUT down to GND.
  let cap: CapLayout | null = null;
  let railEnd = maxX + LEAD_DX + 1;
  if (pullDown) {
    const cx = maxNX + LEAD_DX + 2.4;
    const yMid = (yOut + yGnd) / 2;
    const gap = 0.22;
    const plateW = 0.6;
    cap = {
      x: cx,
      plateTop: [[cx - plateW, yMid - gap], [cx + plateW, yMid - gap]],
      plateBottom: [[cx - plateW, yMid + gap], [cx + plateW, yMid + gap]],
      gauge: [cx + plateW + 0.35, yMid - 0.9, cx + plateW + 0.6, yMid + 0.9],
    };
    wires.push({ node: OUT, points: [[cx, yOut], [cx, yMid - gap]] });
    wires.push({ node: GND, points: [[cx, yMid + gap], [cx, yGnd]] });
    railEnd = Math.max(railEnd, cx + 0.8);
  }

  // Rails and output.
  wires.push({ node: VDD, points: [[x0 - 1, yVdd], [railEnd, yVdd]] });
  if (pullDown) wires.push({ node: GND, points: [[x0 - 1, yGnd], [railEnd, yGnd]] });
  wires.push({ node: OUT, points: [[x0 + LEAD_DX, yOut], [W, yOut]] });

  // Gate inputs: pin → track → each gate it drives.
  ins.forEach((pin, i) => {
    const py = pinPos(def, def.pins[pin])[1] * s;
    const tx = trackX(i);
    for (const f of fets.filter((f) => f.input === pin)) {
      wires.push({ node: `in:${pin}`, points: [[0, py], [tx, py], [tx, f.y], [gateLeadEnd(f), f.y]] });
      const gx = f.x - GATE_GAP;
      wires.push({ node: `in:${pin}`, points: [[gx, f.y - f.half * 0.85], [gx, f.y + f.half * 0.85]] });
    }
  });

  // Rail names sit just left of the rails' ends.
  const labels = [{ text: 'VDD = 1', at: [x0 - 1.3, yVdd] as Point }];
  if (pullDown) labels.push({ text: 'GND = 0', at: [x0 - 1.3, yGnd] as Point });
  return { width: W, height: H, fets, wires, cap, labels };
}

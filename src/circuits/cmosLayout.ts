// Generated transistor schematics for CMOS primitives (DESIGN.md §6.3): VDD rail on top,
// GND rail at the bottom, PMOS pull-up network above the output, NMOS pull-down below.
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
}

export interface CmosWire {
  /** Node name (VDD, GND, OUT, internal p1/n1…) or `in:<pin>` for gate inputs. */
  node: string;
  points: Point[];
  /** Set when this wire is a transistor's own lead (so path highlighting can be exact). */
  fet?: number;
}

export interface CmosLayout {
  width: number;
  height: number;
  fets: FetLayout[];
  wires: CmosWire[];
  labels: { text: string; at: Point }[];
}

export const FET_HALF = 0.7;
/** Horizontal offset from the channel to the gate plate. */
export const GATE_GAP = 0.4;
/** Extra offset for the PMOS inversion bubble. */
export const BUBBLE_R = 0.14;

export function gateLeadEnd(f: FetLayout): number {
  return f.type === 'p' ? f.x - GATE_GAP - 2 * BUBBLE_R : f.x - GATE_GAP;
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
  const dx = 2.8;

  const fets: FetLayout[] = [];
  const wires: CmosWire[] = [];
  const counters = { p: 0, n: 0 };
  let maxX = x0;

  const place = (net: CmosNet, top: string, bottom: string, ya: number, yb: number, type: 'p' | 'n') => {
    const leaves = net.kind === 'fet' ? [net] : net.parts;
    if (leaves.some((l) => l.kind !== 'fet')) throw new Error('Only flat series/parallel networks are laid out');
    const inputsOf = leaves.map((l) => (l as { input: string }).input);
    const k = inputsOf.length;
    const step = (yb - ya) / k;
    if (net.kind === 'parallel') {
      inputsOf.forEach((input, j) => {
        const x = x0 + j * dx;
        const y = ya + (j + 0.5) * step; // staggered so gate leads never cross a channel
        const id = fets.length;
        fets.push({ id, type, input, x, y, half: FET_HALF });
        wires.push({ node: top, fet: id, points: [[x, ya], [x, y - FET_HALF]] });
        wires.push({ node: bottom, fet: id, points: [[x, y + FET_HALF], [x, yb]] });
        maxX = Math.max(maxX, x);
      });
      if (top !== VDD) wires.push({ node: top, points: [[x0, ya], [x0 + (k - 1) * dx, ya]] });
      if (bottom !== GND) wires.push({ node: bottom, points: [[x0, yb], [x0 + (k - 1) * dx, yb]] });
    } else {
      let cur = top;
      let curY = ya;
      inputsOf.forEach((input, i) => {
        const y = ya + (i + 0.5) * step;
        const id = fets.length;
        fets.push({ id, type, input, x: x0, y, half: FET_HALF });
        wires.push({ node: cur, fet: id, points: [[x0, curY], [x0, y - FET_HALF]] });
        cur = i < k - 1 ? `${type}${++counters[type]}` : bottom;
        curY = y + FET_HALF;
      });
      // The last lead runs to the bottom node.
      const last = fets[fets.length - 1];
      wires.push({ node: bottom, fet: last.id, points: [[x0, curY], [x0, yb]] });
    }
  };

  place(def.cmos.pullUp, VDD, OUT, yVdd, yOut, 'p');
  place(def.cmos.pullDown, OUT, GND, yOut, yGnd, 'n');

  // Rails and output.
  wires.push({ node: VDD, points: [[x0 - 1, yVdd], [maxX + 1, yVdd]] });
  wires.push({ node: GND, points: [[x0 - 1, yGnd], [maxX + 1, yGnd]] });
  wires.push({ node: OUT, points: [[x0, yOut], [W, yOut]] });

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
  const labels = [
    { text: 'VDD = 1', at: [x0 - 1.3, yVdd] as Point },
    { text: 'GND = 0', at: [x0 - 1.3, yGnd] as Point },
  ];
  return { width: W, height: H, fets, wires, labels };
}

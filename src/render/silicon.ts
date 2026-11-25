// Silicon view of a CMOS primitive (DESIGN.md §6.2a, Phase 4b): the generated standard-cell
// layout drawn as filled layers, lit by exactly the same values as the transistor schematic.
//   - diffusion pieces follow the switch-level node levels (internal nodes included);
//   - poly stripes follow their input wire; metal paths carry ordinary signal wires on their
//     centre lines, so sparks and the on/off look match the schematic;
//   - a channel glows (solid, thick outline) when its transistor conducts and is dashed when not;
//   - the conducting path is highlighted amber (to VDD) or violet (to GND), as in the schematic.
// Fills stay at or below 1.0 so only active wires, sparks and channels bloom.
import { Color, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import type { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { siliconLayout, type Rect, type SiliconFet, type SiliconLayout, type SiliconRegion } from '../circuits/siliconLayout';
import { inputPins, outputPins } from '../sim/library';
import { cmosNetlist, evaluateSwitches, GND, OUT, VDD, type CmosNetlist } from '../sim/switchLevel';
import type { Bit, ComponentDef, Point } from '../sim/types';
import type { AlphaFn } from './fade';
import { Label } from './labels';
import {
  CHANNEL_ON, CONTACT_COLOR, DIFF_COLOR, LABEL, LABEL_DIM, METAL_COLOR, POLY_COLOR, UNLIT, VDD_COLOR, WELL_COLOR,
} from './palette';
import type { InnerHit, TransistorView, ViewContext } from './views';
import { makeLine, Wire } from './wires';

/** One unit square shared by every fill (never disposed). */
const PLANE = new PlaneGeometry(1, 1);

const rectLine = ([x0, y0, x1, y1]: Rect): Point[] => [[x0, -y0], [x1, -y0], [x1, -y1], [x0, -y1], [x0, -y0]];
const inside = ([x0, y0, x1, y1]: Rect, x: number, y: number, tol: number) =>
  x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol;

/** A filled rectangle with its own material, so it can be dimmed and faded on its own. */
export class Fill {
  readonly mesh: Mesh;
  private readonly mat: MeshBasicMaterial;
  private shown = true;

  constructor(rect: Rect, private readonly color: Color, z: number, private readonly opacity = 1) {
    this.mat = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.mesh = new Mesh(PLANE, this.mat);
    const [x0, y0, x1, y1] = rect;
    this.mesh.position.set((x0 + x1) / 2, -(y0 + y1) / 2, z);
    this.mesh.scale.set(x1 - x0, y1 - y0, 1);
  }

  setLit(lit: boolean): void {
    this.mat.color.copy(this.color).multiplyScalar(lit ? 1 : UNLIT);
  }

  show(on: boolean): void {
    this.shown = on;
  }

  fade(alpha: number): void {
    this.mat.opacity = this.opacity * alpha;
    this.mesh.visible = this.shown && alpha > 0.004;
  }

  dispose(): void {
    this.mat.dispose();
  }
}

interface RegionParts { r: SiliconRegion; fill: Fill; outline: Line2; hl: Line2 }
interface FetParts { f: SiliconFet; glow: Fill; outline: Line2; hl: Line2 }

const Z = { well: -0.06, diff: 0, poly: 0.02, channel: 0.03, metal: 0.04, contact: 0.06, wire: 0.08, hl: -0.08 };

export class SiliconView implements TransistorView {
  readonly silicon = true;
  readonly group = new Group();
  readonly signalWires: { node: string; points: Point[]; net: number }[] = [];
  readonly layout: SiliconLayout;
  private readonly netlist: CmosNetlist;
  private readonly fills: Fill[] = [];
  private readonly regions: RegionParts[] = [];
  private readonly fetParts: FetParts[] = [];
  private readonly stripes: { input: string; fills: Fill[]; outline: Line2 }[] = [];
  private readonly signalMetal: { node: string; fill: Fill }[] = [];
  private readonly outHl: Line2[] = [];
  private readonly wires: [number, Wire][] = [];
  private readonly labels: Label[] = [];
  private readonly inputNets: [string, number][];
  private readonly outNet: number;
  private on: boolean[] = [];
  private level: Record<string, string> = {};
  private lastKey = '';

  constructor(
    private readonly ctx: ViewContext,
    def: ComponentDef,
    worldScale: number,
    netOfPin: (pin: string) => number,
    fadeFn: AlphaFn,
  ) {
    const { mats } = ctx;
    this.netlist = cmosNetlist(def.cmos!);
    const layout = siliconLayout(def);
    this.layout = layout;
    this.inputNets = inputPins(def).map((p) => [p, netOfPin(p)]);
    this.outNet = netOfPin(outputPins(def)[0]);
    const line = (rect: Rect, mat: LineMaterial, z: number) => {
      const l = makeLine(rectLine(rect), mat, z, fadeFn);
      this.group.add(l);
      return l;
    };
    const fill = (rect: Rect, color: Color, z: number, opacity = 1) => {
      const f = new Fill(rect, color, z, opacity);
      f.setLit(false);
      this.group.add(f.mesh);
      this.fills.push(f);
      return f;
    };

    for (const w of layout.wells) fill(w, WELL_COLOR, Z.well, 0.9);
    for (const r of layout.regions) {
      const hl = line(r.rect, mats.pathVdd, Z.hl);
      hl.visible = false;
      this.regions.push({ r, fill: fill(r.rect, DIFF_COLOR, Z.diff), outline: line(r.rect, mats.off, Z.diff + 0.01), hl });
    }
    for (const input of inputPins(def)) {
      const polys = layout.shapes.filter((s) => s.layer === 'poly' && s.node === `in:${input}`);
      const fills = polys.map((p) => fill(p.rect, POLY_COLOR, Z.poly));
      // Outline the long stripe only (the contact pad sits on it).
      const stripe = polys.reduce((a, b) => (b.rect[3] - b.rect[1] > a.rect[3] - a.rect[1] ? b : a));
      this.stripes.push({ input, fills, outline: line(stripe.rect, mats.off, Z.poly + 0.005) });
    }
    for (const f of layout.fets) {
      const glow = fill(f.channel, CHANNEL_ON, Z.channel, 0.55);
      glow.setLit(true);
      glow.show(false);
      const hl = line(f.channel, mats.pathVdd, Z.hl);
      hl.visible = false;
      this.fetParts.push({ f, glow, outline: line(f.channel, mats.channelOff, Z.channel + 0.005), hl });
    }
    for (const s of layout.shapes) {
      if (s.layer === 'metal') {
        const f = fill(s.rect, METAL_COLOR, Z.metal, 0.72);
        if (s.node === VDD || s.node === GND) {
          f.setLit(true);
          line(s.rect, s.node === VDD ? mats.vdd : mats.gnd, Z.metal + 0.005);
        } else this.signalMetal.push({ node: s.node!, fill: f });
      } else if (s.layer === 'contact') {
        fill(s.rect, CONTACT_COLOR, Z.contact).setLit(true);
      }
    }
    // Signal wires on the metal centre lines: the same values, sparks and widths as anywhere else.
    for (const w of layout.wires) {
      const net = w.node === OUT ? this.outNet : netOfPin(w.node.slice(3));
      const wire = new Wire(w.points.map(([x, y]) => [x, -y] as Point), mats, worldScale, fadeFn);
      wire.object.position.z = Z.wire;
      this.group.add(wire.object);
      ctx.nets.add(net, wire);
      this.wires.push([net, wire]);
      this.signalWires.push({ node: w.node, points: w.points, net });
      if (w.node === OUT) {
        const hl = makeLine(w.points.map(([x, y]) => [x, -y] as Point), mats.pathVdd, Z.hl, fadeFn);
        hl.visible = false;
        this.group.add(hl);
        this.outHl.push(hl);
      }
    }
    for (const l of layout.labels) {
      const color = l.kind === 'vdd' ? VDD_COLOR : l.kind === 'gnd' ? LABEL : LABEL_DIM;
      const lb = new Label(l.text, l.at[0], -l.at[1], { size: 0.5, anchorX: l.kind === 'row' ? 'left' : 'right', color });
      this.group.add(lb.text);
      this.labels.push(lb);
    }
  }

  private inputValue(pin: string): Bit {
    return this.ctx.playback.value(this.inputNets.find(([p]) => p === pin)![1]);
  }

  update(pxPerUnit: number, alpha: number): void {
    for (const l of this.labels) l.fit(pxPerUnit, alpha);
    for (const f of this.fills) f.fade(alpha);
    const inputs: Record<string, Bit> = {};
    for (const [p, net] of this.inputNets) inputs[p] = this.ctx.playback.value(net);
    const out = this.ctx.playback.value(this.outNet);
    const key = `${Object.values(inputs).join('')}:${out}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const { mats } = this.ctx;
    const r = evaluateSwitches(this.netlist, inputs);
    this.on = r.on;
    this.level = r.level;
    const hlMat = r.out === 1 ? mats.pathVdd : mats.pathGnd;
    const onPath = new Set(r.path);
    const pathChannels = this.fetParts.filter((p) => onPath.has(p.f.id)).map((p) => p.f.channel);
    // A diffusion piece is on the path when it touches a conducting channel of the path.
    const touches = (a: Rect, c: Rect) =>
      Math.abs(a[1] - c[1]) < 1e-6 && (Math.abs(a[2] - c[0]) < 1e-6 || Math.abs(a[0] - c[2]) < 1e-6);

    for (const p of this.regions) {
      const { node } = p.r;
      const lit = r.level[node] === 'vdd';
      p.fill.setLit(lit);
      p.outline.material = node === VDD ? mats.vdd : node === GND ? mats.gnd : lit ? mats.on : mats.off;
      p.hl.material = hlMat;
      p.hl.visible = pathChannels.some((c) => touches(p.r.rect, c));
    }
    for (const s of this.stripes) {
      const lit = inputs[s.input] === 1;
      for (const f of s.fills) f.setLit(lit);
      s.outline.material = lit ? mats.on : mats.off;
    }
    for (const p of this.fetParts) {
      const on = r.on[p.f.id];
      p.glow.show(on);
      p.outline.material = on ? mats.channelOn : mats.channelOff;
      p.hl.material = hlMat;
      p.hl.visible = onPath.has(p.f.id);
    }
    for (const m of this.signalMetal) m.fill.setLit((m.node === OUT ? out : inputs[m.node.slice(3)]) === 1);
    for (const h of this.outHl) {
      h.material = hlMat;
      h.visible = r.path.length > 0;
    }
  }

  /** Transistor, conductor or contact at a point in inner coordinates (y down). */
  hit(x: number, y: number, tol: number): InnerHit | null {
    const L = this.layout;
    for (const f of L.fets) {
      if (inside(f.channel, x, y, tol)) return { kind: 'fet', fet: f, on: !!this.on[f.id], gate: this.inputValue(f.input) };
    }
    const shapeAt = (layer: string) => L.shapes.find((s) => s.layer === layer && inside(s.rect, x, y, 0));
    const contact = shapeAt('contact');
    if (contact) return { kind: 'layer', layer: 'contact', node: contact.node ?? null, value: null };
    const metal = shapeAt('metal');
    if (metal) {
      const node = metal.node!;
      if (node !== VDD && node !== GND) {
        const net = node === OUT ? this.outNet : this.inputNets.find(([p]) => `in:${p}` === node)![1];
        return { kind: 'wire', net, name: node === OUT ? 'output' : `input ${node.slice(3)}` };
      }
      return { kind: 'layer', layer: 'metal', node, value: node === VDD ? 1 : 0 };
    }
    const poly = shapeAt('poly');
    if (poly) return { kind: 'layer', layer: 'poly', node: poly.node!, value: this.inputValue(poly.node!.slice(3)) };
    const region = L.regions.find((r) => inside(r.rect, x, y, 0));
    if (region) {
      const lv = this.level[region.node];
      return { kind: 'layer', layer: region.type === 'p' ? 'pdiff' : 'ndiff', node: region.node, value: lv === 'vdd' ? 1 : lv === 'gnd' ? 0 : null };
    }
    if (L.wells.some((w) => inside(w, x, y, 0))) return { kind: 'layer', layer: 'well', node: null, value: null };
    return null;
  }

  dispose(): void {
    for (const [net, w] of this.wires) {
      this.ctx.nets.remove(net, w);
      w.dispose();
    }
    for (const f of this.fills) f.dispose();
    for (const l of this.labels) l.dispose();
  }
}

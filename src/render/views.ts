// Zoomable component views (DESIGN.md §6.3). Each instance is drawn either as a closed box
// (gate symbol or rectangle) or, once large enough on screen, as its contents: child parts and
// wires, or for a primitive gate its CMOS transistor schematic.
import { Group, Mesh } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { cmosLayout, BUBBLE_R, GATE_GAP, type CmosWire, type FetLayout } from '../circuits/cmosLayout';
import { innerScale, innerSize, netGeometry, pinPos } from '../circuits/geometry';
import { pinKey, type Circuit } from '../sim/flatten';
import { inputPins, outputPins, type Library } from '../sim/library';
import { cmosNetlist, evaluateSwitches, GND, OUT, VDD, type CmosNetlist } from '../sim/switchLevel';
import type { Bit, ComponentDef, Point } from '../sim/types';
import { Label } from './labels';
import { LABEL_DIM, VDD_COLOR, GND_COLOR } from './palette';
import type { Playback } from './playback';
import { gateSymbol, symbolName } from './symbols';
import { makeLine, Wire, type WireMaterials } from './wires';

/** LOD thresholds in CSS pixels of on-screen width (DESIGN.md §6.3). */
export const COLLAPSE_PX = 140;
export const EXPAND_PX = 220;

/** y-down layout coordinates → y-up local scene coordinates. */
const flip = (pts: readonly Point[]): Point[] => pts.map(([x, y]) => [x, -y] as Point);

/** Keeps every drawn wire of a net in step with the playback. */
export class NetWires {
  private readonly byNet = new Map<number, Set<Wire>>();
  private lastActive = new Set<number>();

  constructor(private readonly playback: Playback) {}

  add(net: number, wire: Wire): void {
    let set = this.byNet.get(net);
    if (!set) {
      set = new Set();
      this.byNet.set(net, set);
    }
    set.add(wire);
    this.sync(net, wire);
  }

  update(): void {
    const now = new Set(this.playback.changing());
    for (const net of new Set([...now, ...this.lastActive])) {
      for (const w of this.byNet.get(net) ?? []) this.sync(net, w);
    }
    this.lastActive = now;
  }

  /** Re-sync everything (after a quality change or a jump). */
  syncAll(): void {
    for (const [net, set] of this.byNet) for (const w of set) {
      w.refresh();
      this.sync(net, w);
    }
  }

  private sync(net: number, w: Wire): void {
    w.setValue(this.playback.value(net));
    w.setTransition(this.playback.transition(net));
  }
}

export interface ViewContext {
  lib: Library;
  circuit: Circuit;
  mats: WireMaterials;
  nets: NetWires;
  playback: Playback;
}

export interface ViewRect {
  left: number;
  right: number;
  bottom: number;
  top: number;
  pxPerWorld: number;
}

export class ComponentView {
  readonly group = new Group();
  private readonly box = new Group();
  private readonly frame = new Group();
  private contents: Group | null = null;
  private children: ComponentView[] = [];
  private cmos: CmosView | null = null;
  private expanded = false;
  private readonly boxLabels: Label[] = [];
  private readonly frameLabels: Label[] = [];
  private readonly wires: Wire[] = [];

  /**
   * @param worldX/worldTop world position of the box's top-left corner
   * @param worldScale world units per box unit
   */
  constructor(
    private readonly ctx: ViewContext,
    readonly def: ComponentDef,
    readonly path: string,
    private readonly worldX: number,
    private readonly worldTop: number,
    private readonly worldScale: number,
  ) {
    this.group.add(this.box, this.frame);
    this.frame.visible = false;
    this.buildBox();
    this.buildFrame();
  }

  get canExpand(): boolean {
    return !!this.def.parts || !!this.def.cmos;
  }

  get isExpanded(): boolean {
    return this.expanded;
  }

  contains(x: number, y: number): boolean {
    const [w, h] = this.def.size;
    return x >= this.worldX && x <= this.worldX + w * this.worldScale
      && y <= this.worldTop && y >= this.worldTop - h * this.worldScale;
  }

  /** World rectangle of the box: [left, bottom, right, top]. */
  get worldBounds(): [number, number, number, number] {
    const [w, h] = this.def.size;
    return [this.worldX, this.worldTop - h * this.worldScale, this.worldX + w * this.worldScale, this.worldTop];
  }

  update(view: ViewRect): void {
    const [l, b, r, t] = this.worldBounds;
    const onScreen = r >= view.left && l <= view.right && t >= view.bottom && b <= view.top;
    const px = (r - l) * view.pxPerWorld;
    if (this.expanded && (px < COLLAPSE_PX || !onScreen)) this.setExpanded(false);
    else if (!this.expanded && this.canExpand && onScreen && px > EXPAND_PX) this.setExpanded(true);

    const pxPerBox = this.worldScale * view.pxPerWorld;
    for (const lb of this.boxLabels) lb.fit(pxPerBox);
    if (!this.expanded) return;
    for (const lb of this.frameLabels) lb.fit(pxPerBox);
    const sub = this.worldScale / innerScale(this.def);
    if (this.cmos) this.cmos.update(sub * view.pxPerWorld);
    for (const c of this.children) c.update(view);
  }

  private setExpanded(on: boolean): void {
    if (on && !this.contents) this.buildContents();
    this.expanded = on;
    this.box.visible = !on;
    this.frame.visible = on;
    if (this.contents) this.contents.visible = on;
    if (!on) for (const c of this.children) c.setExpanded(false);
  }

  private addWire(parent: Group, net: number, pts: Point[], worldScale: number): Wire {
    const w = new Wire(flip(pts), this.ctx.mats, worldScale);
    parent.add(w.object);
    this.ctx.nets.add(net, w);
    this.wires.push(w);
    return w;
  }

  private netOfPin(pin: string): number {
    const n = this.ctx.circuit.pinNet.get(pinKey(this.path, pin));
    if (n === undefined) throw new Error(`No net for ${pinKey(this.path, pin)}`);
    return n;
  }

  private buildBox(): void {
    const { mats } = this.ctx;
    const sym = gateSymbol(this.def);
    const [w, h] = this.def.size;
    if (sym) {
      for (const o of sym.outline) this.box.add(makeLine(flip(o), mats.outline));
      for (const [pin, pts] of sym.stubs) this.addWire(this.box, this.netOfPin(pin), pts, this.worldScale);
      const lb = new Label(symbolName(this.def), sym.labelAt[0], -sym.labelAt[1], { size: sym.labelSize });
      this.box.add(lb.text);
      this.boxLabels.push(lb);
    } else {
      this.box.add(makeLine(flip([[0, 0], [w, 0], [w, h], [0, h], [0, 0]]), mats.outline));
      const lb = new Label(this.def.title, w / 2, -h / 2, { size: Math.min(0.5, h * 0.2) });
      this.box.add(lb.text);
      this.boxLabels.push(lb);
    }
  }

  private buildFrame(): void {
    const [w, h] = this.def.size;
    this.frame.add(makeLine(flip([[0, 0], [w, 0], [w, h], [0, h], [0, 0]]), this.ctx.mats.frame, -0.1));
    const size = Math.min(w, h) * 0.06;
    // Title above the frame, so it never collides with the contents.
    const title = new Label(this.def.title, 0, size * 0.3, {
      size, anchorX: 'left', anchorY: 'bottom', color: LABEL_DIM,
    });
    this.frame.add(title.text);
    this.frameLabels.push(title);
    for (const [name, pin] of Object.entries(this.def.pins)) {
      const [x, y] = pinPos(this.def, pin);
      const inside = pin.side === 'left' ? 1 : -1;
      const lb = new Label(name, x + inside * size * 0.6, -y + size * 0.7, {
        size: size * 0.9, anchorX: pin.side === 'left' ? 'left' : 'right', color: LABEL_DIM,
      });
      this.frame.add(lb.text);
      this.frameLabels.push(lb);
    }
  }

  private buildContents(): void {
    const { ctx, def } = this;
    const s = innerScale(def);
    const g = new Group();
    g.scale.setScalar(1 / s);
    const innerWorld = this.worldScale / s;
    this.contents = g;
    this.group.add(g);

    if (def.cmos) {
      this.cmos = new CmosView(ctx, def, innerWorld, (pin) => this.netOfPin(pin));
      g.add(this.cmos.group);
      return;
    }
    for (const net of def.nets ?? []) {
      const geom = netGeometry(def, net, ctx.lib);
      const id = this.netOfPin(net.from);
      for (const br of geom.branches) this.addWire(g, id, br, innerWorld);
      for (const [x, y] of geom.junctions) {
        const dot = new Mesh(ctx.mats.sparkGeom, ctx.mats.dot);
        dot.scale.setScalar(0.32);
        dot.position.set(x, -y, 0.05);
        g.add(dot);
      }
    }
    for (const [name, part] of Object.entries(def.parts ?? {})) {
      const cdef = ctx.lib.get(part.type);
      const child = new ComponentView(
        ctx, cdef, pinKey(this.path, name),
        this.worldX + part.at[0] * innerWorld,
        this.worldTop - part.at[1] * innerWorld,
        innerWorld,
      );
      child.group.position.set(part.at[0], -part.at[1], 0);
      g.add(child.group);
      this.children.push(child);
    }
  }

  dispose(): void {
    for (const c of this.children) c.dispose();
    for (const w of this.wires) w.dispose();
    for (const l of [...this.boxLabels, ...this.frameLabels]) l.dispose();
    this.cmos?.dispose();
  }
}

interface FetParts {
  f: FetLayout;
  channel: Line2;
  open: Line2;
  closed: Line2;
  hl: Line2;
}

interface NodeWire {
  cw: CmosWire;
  /** Signal wires (inputs, output, internal nodes); rails are plain lines. */
  wire: Wire | null;
  hl: Line2;
}

/** Transistor-level view of one CMOS primitive (inner coordinates of the gate). */
class CmosView {
  readonly group = new Group();
  private readonly netlist: CmosNetlist;
  private readonly fets: FetParts[] = [];
  private readonly nodes: NodeWire[] = [];
  private readonly inputNets: [string, number][];
  private readonly labels: Label[] = [];
  private readonly wires: Wire[] = [];
  private lastKey = '';

  constructor(
    private readonly ctx: ViewContext,
    def: ComponentDef,
    worldScale: number,
    netOfPin: (pin: string) => number,
  ) {
    const { mats } = ctx;
    this.netlist = cmosNetlist(def.cmos!);
    const layout = cmosLayout(def);
    this.inputNets = inputPins(def).map((p) => [p, netOfPin(p)]);
    const outNet = netOfPin(outputPins(def)[0]);

    for (const cw of layout.wires) {
      const pts = flip(cw.points);
      const hl = makeLine(pts, mats.pathVdd, -0.08);
      hl.visible = false;
      this.group.add(hl);
      let wire: Wire | null = null;
      if (cw.node === VDD || cw.node === GND) {
        this.group.add(makeLine(pts, cw.node === VDD ? mats.vdd : mats.gnd));
      } else {
        wire = new Wire(pts, mats, worldScale);
        this.group.add(wire.object);
        this.wires.push(wire);
        if (cw.node === OUT) ctx.nets.add(outNet, wire);
        else if (cw.node.startsWith('in:')) ctx.nets.add(netOfPin(cw.node.slice(3)), wire);
      }
      this.nodes.push({ cw, wire, hl });
    }

    for (const f of layout.fets) {
      const ch = flip([[f.x, f.y - f.half], [f.x, f.y + f.half]]);
      const channel = makeLine(ch, mats.channelOff, 0.02);
      const hl = makeLine(ch, mats.pathVdd, -0.08);
      hl.visible = false;
      const xi = f.x + 0.75;
      const closed = makeLine(flip([[xi, f.y + 0.45], [xi, f.y - 0.45]]), mats.outline);
      const open = makeLine(flip([[xi, f.y + 0.45], [xi + 0.4, f.y - 0.3]]), mats.outline);
      const ticks = makeLine(flip([[xi - 0.15, f.y - 0.45], [xi + 0.15, f.y - 0.45]]), mats.outline);
      this.group.add(channel, hl, closed, open, ticks);
      if (f.type === 'p') {
        const cx = f.x - GATE_GAP - BUBBLE_R;
        const ring: Point[] = Array.from({ length: 17 }, (_, i) => {
          const a = (i / 16) * Math.PI * 2;
          return [cx + Math.cos(a) * BUBBLE_R, f.y + Math.sin(a) * BUBBLE_R] as Point;
        });
        this.group.add(makeLine(flip(ring), mats.outline));
      }
      const tag = new Label(f.type === 'p' ? 'P' : 'N', f.x + 1.35, -f.y, { size: 0.5, anchorX: 'left', color: LABEL_DIM });
      this.group.add(tag.text);
      this.labels.push(tag);
      this.fets.push({ f, channel, open, closed, hl });
    }

    for (const l of layout.labels) {
      const isVdd = l.text.startsWith('VDD');
      const lb = new Label(l.text, l.at[0], -l.at[1], {
        size: 0.5, anchorX: 'right', color: isVdd ? VDD_COLOR : GND_COLOR,
      });
      this.group.add(lb.text);
      this.labels.push(lb);
    }
    const [w, h] = innerSize(def);
    const pu = new Label('pull-up: PMOS', w - 0.3, -(h * 0.08), { size: 0.5, anchorX: 'right', color: LABEL_DIM });
    const pd = new Label('pull-down: NMOS', w - 0.3, -(h * 0.92), { size: 0.5, anchorX: 'right', color: LABEL_DIM });
    this.group.add(pu.text, pd.text);
    this.labels.push(pu, pd);
  }

  update(pxPerUnit: number): void {
    for (const l of this.labels) l.fit(pxPerUnit);
    const inputs: Record<string, Bit> = {};
    for (const [p, net] of this.inputNets) inputs[p] = this.ctx.playback.value(net);
    const key = Object.values(inputs).join('');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const r = evaluateSwitches(this.netlist, inputs);
    const mats = this.ctx.mats;
    const hlMat = r.out === 1 ? mats.pathVdd : mats.pathGnd;
    const onPath = new Set(r.path);
    const pathNodes = new Set<string>();
    for (const id of r.path) {
      const t = this.netlist.transistors[id];
      pathNodes.add(t.a).add(t.b);
    }
    for (const p of this.fets) {
      const on = r.on[p.f.id];
      p.channel.material = on ? mats.channelOn : mats.channelOff;
      p.closed.visible = on;
      p.open.visible = !on;
      p.hl.material = hlMat;
      p.hl.visible = onPath.has(p.f.id);
    }
    for (const n of this.nodes) {
      const { cw } = n;
      if (n.wire && cw.node !== OUT && !cw.node.startsWith('in:')) n.wire.setValue(r.level[cw.node] === 'vdd' ? 1 : 0);
      const isRail = cw.node === VDD || cw.node === GND;
      n.hl.material = hlMat;
      n.hl.visible = !cw.node.startsWith('in:')
        && (cw.fet !== undefined ? onPath.has(cw.fet) : !isRail && pathNodes.has(cw.node));
    }
  }

  dispose(): void {
    for (const w of this.wires) w.dispose();
    for (const l of this.labels) l.dispose();
  }
}

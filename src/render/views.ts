// Zoomable component views (DESIGN.md §6.3). Each instance is drawn either as a closed box
// (gate symbol or rectangle) or, once large enough on screen, as its contents: child parts and
// wires, or for a primitive gate its CMOS transistor schematic.
//
// LOD: contents are created lazily when an instance first opens, crossfade with the box,
// stay cached while nearby, and are disposed once the instance is collapsed and small or far
// away. Instances outside the visible area are culled (hidden and not updated).
//
// Behavioural instances (a D flip-flop in a register, DESIGN.md §5.2) have no gates in the main
// simulation. When one opens, its contents are a local structural copy with its own simulator
// and playback, driven by the values that arrive at the instance's pins.
import { Group, Mesh, PlaneGeometry, type Object3D } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { cmosLayout, type CapLayout, type CmosWire, type FetLayout } from '../circuits/cmosLayout';
import { innerScale, innerSize, minPinGap, netGeometry, pinPos } from '../circuits/geometry';
import { pinKey, type Circuit } from '../sim/flatten';
import { inputPins, outputPins, type Library } from '../sim/library';
import { LocalSim } from '../sim/local';
import { cmosNetlist, evaluateSwitches, GND, OUT, VDD, type CmosNetlist } from '../sim/switchLevel';
import type { Bit, ComponentDef, Point } from '../sim/types';
import type { AlphaFn } from './fade';
import { Label } from './labels';
import {
  DISPOSE_PX, ease, intersects, screenSize, shouldDispose, stepAlpha, wantExpanded, type Bounds, type Rect,
} from './lod';
import { LABEL_DIM, VDD_COLOR, GND_COLOR } from './palette';
import { chargeLevel, Playback } from './playback';
import { gateSymbol, symbolName } from './symbols';
import { makeLine, Wire, type WireMaterials } from './wires';
import { TableView } from './table';
import { SiliconView } from './silicon';
import type { Layer } from '../circuits/siliconLayout';

/** y-down layout coordinates → y-up local scene coordinates. */
const flip = (pts: readonly Point[]): Point[] => pts.map(([x, y]) => [x, -y] as Point);

/** Below this effective opacity a layer is not drawn at all. */
const HIDDEN = 0.004;

/** Keeps every drawn wire of a net in step with the playback. */
export class NetWires {
  private readonly byNet = new Map<number, Set<Wire>>();
  private lastActive = new Set<number>();
  /** Nets whose displayed value changed since the last update (instant changes never show as "changing"). */
  private readonly settled = new Set<number>();

  constructor(private readonly playback: Playback) {
    playback.listen((net) => this.settled.add(net));
  }

  add(net: number, wire: Wire): void {
    let set = this.byNet.get(net);
    if (!set) {
      set = new Set();
      this.byNet.set(net, set);
    }
    set.add(wire);
    this.sync(net, wire);
  }

  remove(net: number, wire: Wire): void {
    const set = this.byNet.get(net);
    if (!set) return;
    set.delete(wire);
    if (set.size === 0) this.byNet.delete(net);
  }

  /** Number of wires currently registered (for tests and stats). */
  get size(): number {
    let n = 0;
    for (const s of this.byNet.values()) n += s.size;
    return n;
  }

  update(): void {
    const now = new Set(this.playback.changing());
    for (const net of new Set([...now, ...this.lastActive, ...this.settled])) {
      for (const w of this.byNet.get(net) ?? []) this.sync(net, w);
    }
    this.settled.clear();
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
  /** Crossfade duration in seconds; 0 = instant (reduced motion). */
  fadeSec: number;
  /** "Schematic | Silicon" toggle (DESIGN.md §6.2a), shared by every view of the scene. */
  silicon: SiliconMode;
}

/** Which drawing a primitive's inside uses. One object shared by reference, so flipping it reaches every view. */
export interface SiliconMode {
  on: boolean;
}

/** What a hovered silicon layer is: its layer, node and value (null when it has none). */
export type SiliconLayerKind = Layer | 'well';

export interface ViewRect extends Rect {
  pxPerWorld: number;
}

/** What is under the pointer. */
export type Hit =
  | { kind: 'component'; view: ComponentView }
  | { kind: 'wire'; view: ComponentView; net: number; name: string }
  | { kind: 'fet'; view: ComponentView; fet: { type: 'p' | 'n'; input: string }; on: boolean; gate: Bit }
  | { kind: 'cap'; view: ComponentView; charge: number }
  | { kind: 'layer'; view: ComponentView; layer: SiliconLayerKind; node: string | null; value: Bit | null };

type WithoutView<T> = T extends unknown ? Omit<T, 'view'> : never;
/** A hit inside a primitive's transistor view (the component view adds itself). */
export type InnerHit = WithoutView<Exclude<Hit, { kind: 'component' }>>;

/** A primitive's inside: the CMOS schematic or the silicon layout. */
export interface TransistorView {
  readonly group: Group;
  readonly silicon: boolean;
  /** Input and output wires with their nets, for hover. */
  readonly signalWires: { node: string; points: Point[]; net: number }[];
  update(pxPerUnit: number, alpha: number): void;
  hit(x: number, y: number, tol: number): InnerHit | null;
  dispose(): void;
}

/** The local structural copy behind an opened behavioural instance. */
interface LocalCopy {
  sim: LocalSim;
  ctx: ViewContext;
  stopListening: () => void;
}

interface WireHit {
  net: number;
  name: string;
  /** Polyline in world coordinates. */
  pts: Point[];
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Free the per-line geometry of every Line2 below `root` (materials and meshes are shared). */
function disposeLines(root: Object3D): void {
  root.traverse((o) => {
    if ((o as Line2).isLine2) (o as Line2).geometry.dispose();
  });
}

export function distToPolyline(p: Point, line: readonly Point[]): number {
  let d = Infinity;
  for (let i = 1; i < line.length; i++) d = Math.min(d, distToSegment(p, line[i - 1], line[i]));
  return d;
}

export class ComponentView {
  readonly group = new Group();
  private readonly box = new Group();
  private readonly frame = new Group();
  private contents: Group | null = null;
  private children: ComponentView[] = [];
  private cmos: TransistorView | null = null;
  private table: TableView | null = null;
  private local: LocalCopy | null = null;
  /** Wants to show its contents (with hysteresis). */
  private target = false;
  /** Crossfade position: 0 = box, 1 = contents. */
  private alpha = 0;
  /** Effective opacity of the box and of the contents, including the parents' fades. */
  private boxAlpha = 1;
  private contentAlpha = 0;
  private readonly boxLabels: Label[] = [];
  private readonly frameLabels: Label[] = [];
  private busLabel: Label | null = null;
  private readonly boxWires: [number, Wire][] = [];
  private contentWires: [number, Wire][] = [];
  private dots: Mesh[] = [];
  private wireHits: WireHit[] = [];
  private readonly innerWorld: number;
  private readonly boxFade: AlphaFn = () => this.boxAlpha;
  private readonly contentFade: AlphaFn = () => this.contentAlpha;

  /**
   * @param worldX/worldTop world position of the box's top-left corner
   * @param worldScale world units per box unit
   * @param partLabel the part's label in its parent (e.g. "bit 3"), if any
   */
  constructor(
    private readonly ctx: ViewContext,
    readonly def: ComponentDef,
    readonly path: string,
    private readonly worldX: number,
    private readonly worldTop: number,
    private readonly worldScale: number,
    readonly partLabel?: string,
  ) {
    this.innerWorld = worldScale / innerScale(def);
    this.group.add(this.box, this.frame);
    this.frame.visible = false;
    this.buildBox();
    this.buildFrame();
  }

  get canExpand(): boolean {
    return !!this.def.parts || !!this.def.cmos || !!this.def.table;
  }

  /** Rows of a ROM/PLA table that are active right now (empty when not a table). */
  get activeRows(): number[] {
    if (this.table && this.isExpanded) return this.table.active;
    if (!this.def.table) return [];
    return this.def.table.active(inputPins(this.def).map((p) => this.pinValue(p)));
  }

  /** Transistors drawn on screen: opened instances count their visible children, closed ones themselves. */
  transistorsInView(view: Rect, count: (def: ComponentDef) => number): number {
    if (!this.group.visible || !intersects(this.worldBounds, view)) return 0;
    if (this.isExpanded && this.children.length) {
      return this.children.reduce((n, c) => n + c.transistorsInView(view, count), 0);
    }
    return count(this.def);
  }

  /**
   * True when an opened gate (a transistor view) is on screen inside `view`. Only those change
   * with the Schematic | Silicon toggle: closed gate boxes keep their symbols (DESIGN.md §11).
   */
  showsTransistorsIn(view: Rect): boolean {
    if (!this.group.visible || !intersects(this.worldBounds, view) || !this.isExpanded) return false;
    if (this.isTransistorView) return true;
    return this.children.some((c) => c.showsTransistorsIn(view));
  }

  /** True once the contents are (mostly) showing. */
  get isExpanded(): boolean {
    return !!this.contents && this.alpha >= 0.5;
  }

  /** True while the contents exist in memory (shown or cached). */
  get isBuilt(): boolean {
    return !!this.contents;
  }

  /** Name for breadcrumbs and tooltips. */
  get displayName(): string {
    return this.partLabel ? `${this.def.title} (${this.partLabel})` : this.def.title;
  }

  get isTransistorView(): boolean {
    return !!this.cmos && this.isExpanded;
  }

  /** The transistor view shown is the silicon layout. */
  get isSiliconView(): boolean {
    return !!this.cmos?.silicon && this.isExpanded;
  }

  /** Gate level (DESIGN.md §6.2a): opened, with primitive gates among its parts. */
  get showsGates(): boolean {
    return this.isExpanded && this.children.some((c) => !!c.def.cmos);
  }

  /** Simulated as one behavioural node, so its inside is a local structural copy (§5.2). */
  get isBehavioural(): boolean {
    return !!this.def.parts && this.ctx.circuit.gateByPath.has(this.path);
  }

  /** Displayed value of a net drawn inside this instance (the local copy's nets, if any). */
  wireValue(net: number): Bit {
    return this.innerCtx.playback.value(net);
  }

  /** Context for the contents: the local copy's, or the same as the box's. */
  private get innerCtx(): ViewContext {
    return this.local?.ctx ?? this.ctx;
  }

  /** Net of a pin reference inside the contents (`'x1.a'` or an own pin). */
  private innerNet(ref: string): number {
    const key = this.local ? ref : pinKey(this.path, ref);
    const n = this.innerCtx.circuit.pinNet.get(key);
    if (n === undefined) throw new Error(`No net for ${key}`);
    return n;
  }

  contains(x: number, y: number, tol = 0): boolean {
    const [l, b, r, t] = this.worldBounds;
    return x >= l - tol && x <= r + tol && y >= b - tol && y <= t + tol;
  }

  /** World rectangle of the box: [left, bottom, right, top]. */
  get worldBounds(): Bounds {
    const [w, h] = this.def.size;
    return [this.worldX, this.worldTop - h * this.worldScale, this.worldX + w * this.worldScale, this.worldTop];
  }

  /** Net carrying one of this instance's pins. */
  netOfPin(pin: string): number {
    const n = this.ctx.circuit.pinNet.get(pinKey(this.path, pin));
    if (n === undefined) throw new Error(`No net for ${pinKey(this.path, pin)}`);
    return n;
  }

  pinValue(pin: string): Bit {
    return this.ctx.playback.value(this.netOfPin(pin));
  }

  update(view: ViewRect, dtSec: number, parentAlpha = 1): void {
    if (this.local) {
      const pb = this.local.ctx.playback;
      pb.msPerDelta = this.ctx.playback.msPerDelta;
      pb.update(dtSec * 1000);
      this.local.ctx.nets.update();
    }
    const b = this.worldBounds;
    const px = screenSize(b, view.pxPerWorld);
    if (!intersects(b, view)) {
      // Culled: nobody sees it, so collapse at once and maybe free the cached contents.
      this.group.visible = false;
      this.resetCollapsed();
      if (this.contents && shouldDispose(0, px, b, view)) this.disposeContents();
      return;
    }
    this.group.visible = true;
    this.target = wantExpanded(this.target, px, this.canExpand);
    if (this.target && !this.contents) this.buildContents();
    this.alpha = stepAlpha(this.alpha, this.target ? 1 : 0, dtSec, this.ctx.fadeSec);
    if (this.alpha === 0 && this.contents) {
      // Closed: the children are hidden. Free the ones too small to open again soon.
      for (const c of this.children) {
        c.resetCollapsed();
        if (screenSize(c.worldBounds, view.pxPerWorld) < DISPOSE_PX) c.disposeContents();
      }
      if (shouldDispose(0, px, b, view)) this.disposeContents();
    }

    const a = ease(this.alpha);
    this.boxAlpha = parentAlpha * (1 - a);
    this.contentAlpha = parentAlpha * a;
    const showBox = this.boxAlpha > HIDDEN;
    const showInside = !!this.contents && this.contentAlpha > HIDDEN;
    this.box.visible = showBox;
    this.frame.visible = showInside;
    if (this.contents) this.contents.visible = showInside;

    const pxPerBox = this.worldScale * view.pxPerWorld;
    if (showBox) {
      for (const lb of this.boxLabels) lb.fit(pxPerBox, this.boxAlpha);
      this.updateBusLabel(pxPerBox);
    }
    if (!showInside) return;
    for (const lb of this.frameLabels) lb.fit(pxPerBox, this.contentAlpha);
    const pxPerInner = this.innerWorld * view.pxPerWorld;
    for (const d of this.dots) d.visible = this.contentAlpha > 0.5;
    if (this.cmos && this.cmos.silicon !== this.innerCtx.silicon.on) this.buildTransistorView();
    if (this.cmos) this.cmos.update(pxPerInner, this.contentAlpha);
    if (this.table) this.table.update(this.contentAlpha);
    for (const c of this.children) c.update(view, dtSec, this.contentAlpha);
  }

  /** Snap back to the closed box (used when a parent closes or the instance leaves the screen). */
  private resetCollapsed(): void {
    if (this.alpha === 0 && !this.target) return;
    this.target = false;
    this.alpha = 0;
    this.boxAlpha = 1;
    this.contentAlpha = 0;
    this.box.visible = true;
    this.frame.visible = false;
    if (this.contents) this.contents.visible = false;
    for (const c of this.children) c.resetCollapsed();
  }

  /** What is at a world point: a child part, a wire, a transistor, or this component itself. */
  hit(x: number, y: number, tol: number): Hit | null {
    if (!this.group.visible || !this.contains(x, y, tol)) return null;
    if (this.isExpanded) {
      for (const c of this.children) {
        const h = c.hit(x, y, tol);
        if (h) return h;
      }
      if (this.cmos) {
        const lx = (x - this.worldX) / this.innerWorld;
        const ly = (this.worldTop - y) / this.innerWorld;
        const h = this.cmos.hit(lx, ly, tol / this.innerWorld);
        if (h) return { ...h, view: this } as Hit;
      }
      let best: WireHit | null = null;
      let bestD = tol;
      for (const w of this.wireHits) {
        const d = distToPolyline([x, y], w.pts);
        if (d <= bestD) {
          best = w;
          bestD = d;
        }
      }
      if (best) return { kind: 'wire', view: this, net: best.net, name: best.name };
    }
    return this.contains(x, y) ? { kind: 'component', view: this } : null;
  }

  /** The chain of opened instances from this one down to the one containing (x, y). */
  focusChain(x: number, y: number): ComponentView[] {
    const out: ComponentView[] = [this];
    let cur: ComponentView = this;
    while (cur.isExpanded) {
      const next = cur.children.find((c) => c.group.visible && c.isExpanded && c.contains(x, y));
      if (!next) break;
      out.push(next);
      cur = next;
    }
    return out;
  }

  /** Every instance currently built (shown or cached), for tests and stats. */
  countBuilt(): number {
    return (this.contents ? 1 : 0) + this.children.reduce((n, c) => n + c.countBuilt(), 0);
  }

  private toWorld([x, y]: Point): Point {
    return [this.worldX + x * this.innerWorld, this.worldTop - y * this.innerWorld];
  }

  private addWire(parent: Group, net: number, pts: Point[], worldScale: number, fade: AlphaFn, ctx = this.ctx): Wire {
    const w = new Wire(flip(pts), ctx.mats, worldScale, fade);
    parent.add(w.object);
    ctx.nets.add(net, w);
    return w;
  }

  private buildBox(): void {
    const { mats } = this.ctx;
    const sym = gateSymbol(this.def);
    const [w, h] = this.def.size;
    const fade = this.boxFade;
    if (sym) {
      for (const o of sym.outline) this.box.add(makeLine(flip(o), mats.outline, 0, fade));
      for (const [pin, pts] of sym.stubs) {
        const net = this.netOfPin(pin);
        this.boxWires.push([net, this.addWire(this.box, net, pts, this.worldScale, fade)]);
      }
      const lb = new Label(symbolName(this.def), sym.labelAt[0], -sym.labelAt[1], { size: sym.labelSize });
      this.box.add(lb.text);
      this.boxLabels.push(lb);
      return;
    }
    this.box.add(makeLine(flip([[0, 0], [w, 0], [w, h], [0, h], [0, 0]]), mats.outline, 0, fade));
    const clk = this.def.pins.clk;
    if (clk?.side === 'left') {
      // The usual clock-input mark: a small triangle on the box edge.
      const k = Math.min(w, h) * 0.12;
      this.box.add(makeLine(flip([[0, clk.at - k], [k * 1.2, clk.at], [0, clk.at + k]]), mats.outline, 0, fade));
    }
    const size = Math.min(h * 0.2, (w * 1.4) / Math.max(8, this.def.title.length));
    const hasBuses = !!this.def.buses;
    const title = new Label(this.def.title, w / 2, -h * (hasBuses ? 0.3 : 0.5) + (this.partLabel ? size * 0.6 : 0), { size });
    this.box.add(title.text);
    this.boxLabels.push(title);
    if (this.partLabel) {
      const sub = new Label(this.partLabel, w / 2, title.text.position.y - size * 1.3, { size: size * 0.85, color: LABEL_DIM });
      this.box.add(sub.text);
      this.boxLabels.push(sub);
    }
    if (hasBuses) {
      this.busLabel = new Label('', w / 2, -h * 0.55, { size: size * 0.9, anchorY: 'top' });
      this.box.add(this.busLabel.text);
    }
  }

  /** Bus values shown on the closed box ("A = 7"), DESIGN.md §6.3. */
  private updateBusLabel(pxPerBox: number): void {
    if (!this.busLabel) return;
    const lines = Object.entries(this.def.buses!).map(([name, bus]) => {
      let v = 0;
      bus.pins.forEach((p, i) => (v |= this.pinValue(p) << i));
      if ((bus.signed ?? true) && v >= 2 ** (bus.pins.length - 1)) v -= 2 ** bus.pins.length;
      return `${name} = ${v}`;
    });
    this.busLabel.content = lines.join('\n');
    this.busLabel.fit(pxPerBox, this.boxAlpha);
  }

  private buildFrame(): void {
    const [w, h] = this.def.size;
    const fade = this.contentFade;
    this.frame.add(makeLine(flip([[0, 0], [w, 0], [w, h], [0, h], [0, 0]]), this.ctx.mats.frame, -0.1, fade));
    const size = Math.min(w, h) * 0.06;
    // Title above the frame, so it never collides with the contents.
    const title = new Label(this.displayName, 0, size * 0.3, {
      size, anchorX: 'left', anchorY: 'bottom', color: LABEL_DIM,
    });
    this.frame.add(title.text);
    this.frameLabels.push(title);
    const pinSize = Math.min(size * 0.9, minPinGap(this.def) * 0.6);
    for (const [name, pin] of Object.entries(this.def.pins)) {
      const [x, y] = pinPos(this.def, pin);
      let lx = x;
      let ly = -y;
      let anchorX: 'left' | 'right' | 'center' = 'center';
      if (pin.side === 'left') [lx, ly, anchorX] = [x + pinSize * 0.5, -y + pinSize * 0.7, 'left'];
      else if (pin.side === 'right') [lx, ly, anchorX] = [x - pinSize * 0.5, -y + pinSize * 0.7, 'right'];
      else if (pin.side === 'top') [lx, ly, anchorX] = [x - pinSize * 0.4, -y - pinSize * 0.8, 'right'];
      else [lx, ly, anchorX] = [x - pinSize * 0.4, -y + pinSize * 0.8, 'right'];
      const lb = new Label(name, lx, ly, { size: pinSize, anchorX, color: LABEL_DIM });
      this.frame.add(lb.text);
      this.frameLabels.push(lb);
    }
  }

  /** A structural copy driven by the displayed values at this instance's input pins. */
  private createLocal(): LocalCopy {
    const { ctx, def } = this;
    const shown = (p: string) => ctx.playback.value(this.netOfPin(p));
    const ins = inputPins(def);
    // The stored bit is what the behavioural node shows at its (first) output.
    const sim = new LocalSim(def, ctx.lib, Object.fromEntries(ins.map((p) => [p, shown(p)])), shown(outputPins(def)[0]));
    const playback = new Playback(Array.from({ length: sim.circuit.netCount }, (_, i) => sim.sim.get(i)));
    playback.msPerDelta = ctx.playback.msPerDelta;
    const local: LocalCopy = {
      sim,
      ctx: { ...ctx, circuit: sim.circuit, playback, nets: new NetWires(playback) },
      stopListening: () => {},
    };
    const pinOfNet = new Map(ins.map((p) => [this.netOfPin(p), p]));
    local.stopListening = ctx.playback.listen((net, v) => {
      const pin = pinOfNet.get(net);
      if (pin === undefined) return;
      playback.msPerDelta = ctx.playback.msPerDelta;
      playback.push(sim.drive({ [pin]: v }));
    });
    return local;
  }

  private buildContents(): void {
    const { def } = this;
    if (this.isBehavioural) this.local = this.createLocal();
    const ctx = this.innerCtx;
    const innerPath = this.local ? '' : this.path;
    const s = innerScale(def);
    const g = new Group();
    g.scale.setScalar(1 / s);
    const innerWorld = this.innerWorld;
    const fade = this.contentFade;
    this.contents = g;
    this.group.add(g);

    if (def.table) {
      this.table = new TableView(
        def, ctx.mats, (net, w) => ctx.nets.add(net, w), (pin) => this.innerNet(pin), (net) => ctx.playback.value(net),
        innerWorld, fade,
      );
      g.add(this.table.group);
      return;
    }
    if (def.cmos) {
      this.buildTransistorView();
      return;
    }
    for (const net of def.nets ?? []) {
      const geom = netGeometry(def, net, ctx.lib);
      const id = this.innerNet(net.from);
      const name = net.name ?? net.from;
      for (const br of geom.branches) {
        this.contentWires.push([id, this.addWire(g, id, br, innerWorld, fade, ctx)]);
        this.wireHits.push({ net: id, name, pts: br.map((p) => this.toWorld(p)) });
      }
      for (const [x, y] of geom.junctions) {
        const dot = new Mesh(ctx.mats.sparkGeom, ctx.mats.dot);
        dot.scale.setScalar(0.32);
        dot.position.set(x, -y, 0.05);
        g.add(dot);
        this.dots.push(dot);
      }
    }
    for (const [name, part] of Object.entries(def.parts ?? {})) {
      const cdef = ctx.lib.get(part.type);
      const child = new ComponentView(
        ctx, cdef, pinKey(innerPath, name),
        this.worldX + part.at[0] * innerWorld,
        this.worldTop - part.at[1] * innerWorld,
        innerWorld,
        part.label,
      );
      child.group.position.set(part.at[0], -part.at[1], 0);
      g.add(child.group);
      this.children.push(child);
    }
  }

  /**
   * (Re)build a primitive's inside as a schematic or as silicon, following the toggle. Only the
   * drawing changes: the nets, playback and camera are untouched, so values and zoom stay put.
   */
  private buildTransistorView(): void {
    const ctx = this.innerCtx;
    if (this.cmos) {
      this.cmos.dispose();
      disposeLines(this.cmos.group);
      this.contents!.remove(this.cmos.group);
    }
    const args = [ctx, this.def, this.innerWorld, (pin: string) => this.innerNet(pin), this.contentFade] as const;
    this.cmos = ctx.silicon.on ? new SiliconView(...args) : new CmosView(...args);
    this.contents!.add(this.cmos.group);
    this.wireHits = this.cmos.signalWires.map(({ node, points, net }) => ({
      net, name: node === OUT ? 'output' : `input ${node.slice(3)}`, pts: points.map((p) => this.toWorld(p)),
    }));
  }

  private disposeContents(): void {
    if (!this.contents) return;
    for (const c of this.children) c.dispose();
    for (const [net, w] of this.contentWires) {
      this.innerCtx.nets.remove(net, w);
      w.dispose();
    }
    this.local?.stopListening();
    this.local = null;
    this.cmos?.dispose();
    if (this.table) {
      for (const [net, w] of this.table.netWires) this.innerCtx.nets.remove(net, w);
      this.table.dispose();
    }
    this.table = null;
    disposeLines(this.contents);
    this.group.remove(this.contents);
    this.contents = null;
    this.children = [];
    this.cmos = null;
    this.contentWires = [];
    this.dots = [];
    this.wireHits = [];
    this.target = false;
    this.alpha = 0;
  }

  dispose(): void {
    this.disposeContents();
    for (const [net, w] of this.boxWires) {
      this.ctx.nets.remove(net, w);
      w.dispose();
    }
    for (const l of [...this.boxLabels, ...this.frameLabels]) l.dispose();
    this.busLabel?.dispose();
    disposeLines(this.box);
    disposeLines(this.frame);
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
class CmosView implements TransistorView {
  readonly silicon = false;
  readonly group = new Group();
  /** Input and output wires with their nets, for hover. */
  readonly signalWires: { node: string; points: Point[]; net: number }[] = [];
  private readonly netlist: CmosNetlist;
  private readonly layout: { fets: FetLayout[]; cap: CapLayout | null };
  private readonly fets: FetParts[] = [];
  private readonly nodes: NodeWire[] = [];
  private readonly inputNets: [string, number][];
  private readonly outNet: number;
  private readonly labels: Label[] = [];
  private readonly wires: [number | null, Wire][] = [];
  private readonly gaugeFill: Mesh | null = null;
  private readonly gaugeGeom = new PlaneGeometry(1, 1);
  private on: boolean[] = [];
  private lastKey = '';

  constructor(
    private readonly ctx: ViewContext,
    def: ComponentDef,
    worldScale: number,
    netOfPin: (pin: string) => number,
    fade: AlphaFn,
  ) {
    const { mats } = ctx;
    this.netlist = cmosNetlist(def.cmos!);
    const layout = cmosLayout(def);
    this.layout = layout;
    this.inputNets = inputPins(def).map((p) => [p, netOfPin(p)]);
    this.outNet = netOfPin(outputPins(def)[0]);
    const line = (pts: Point[], mat: typeof mats.outline, z = 0) => makeLine(flip(pts), mat, z, fade);

    for (const cw of layout.wires) {
      const hl = line(cw.points, mats.pathVdd, -0.08);
      hl.visible = false;
      this.group.add(hl);
      let wire: Wire | null = null;
      if (cw.node === VDD || cw.node === GND) {
        this.group.add(line(cw.points, cw.node === VDD ? mats.vdd : mats.gnd));
      } else {
        wire = new Wire(flip(cw.points), mats, worldScale, fade);
        this.group.add(wire.object);
        let net: number | null = null;
        if (cw.node === OUT) net = this.outNet;
        else if (cw.node.startsWith('in:')) net = netOfPin(cw.node.slice(3));
        if (net !== null) {
          ctx.nets.add(net, wire);
          this.signalWires.push({ node: cw.node, points: cw.points, net });
        }
        this.wires.push([net, wire]);
      }
      this.nodes.push({ cw, wire, hl });
    }

    for (const f of layout.fets) {
      const ch: Point[] = [[f.x, f.y - f.half], [f.x, f.y + f.half]];
      const channel = line(ch, mats.channelOff, 0.02);
      const hl = line(ch, mats.pathVdd, -0.08);
      hl.visible = false;
      const closed = line(f.switchClosed, mats.outline);
      const open = line(f.switchOpen, mats.outline);
      this.group.add(channel, hl, closed, open, line(f.switchTicks, mats.outline));
      for (const sh of f.shapes) this.group.add(line(sh, mats.outline));
      const tag = new Label(f.type === 'p' ? 'P' : 'N', f.tagAt[0], -f.tagAt[1], { size: 0.5, anchorX: 'left', color: LABEL_DIM });
      this.group.add(tag.text);
      this.labels.push(tag);
      this.fets.push({ f, channel, open, closed, hl });
    }

    // Load capacitor (§6.2a): faint plates and a gauge showing the stored charge.
    const { cap } = layout;
    if (cap) {
      const [gx0, gy0, gx1, gy1] = cap.gauge;
      this.group.add(line(cap.plateTop, mats.cap), line(cap.plateBottom, mats.cap));
      this.group.add(line([[gx0, gy0], [gx1, gy0], [gx1, gy1], [gx0, gy1], [gx0, gy0]], mats.cap));
      this.gaugeFill = new Mesh(this.gaugeGeom, mats.charge);
      this.gaugeFill.position.z = -0.01;
      this.group.add(this.gaugeFill);
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
    // In the margins above VDD and below GND, clear of the rails.
    const pu: Label = new Label('pull-up: PMOS', w - 0.3, -0.42, { size: 0.5, anchorX: 'right', color: LABEL_DIM });
    if (def.cmos!.pullDown) {
      // (A bench transistor has no pull-up/pull-down pair: its bench title names it.)
      this.group.add(pu.text);
      this.labels.push(pu);
      const pd = new Label('pull-down: NMOS', w - 0.3, -(h - 0.42), { size: 0.5, anchorX: 'right', color: LABEL_DIM });
      this.group.add(pd.text);
      this.labels.push(pd);
    }
  }

  /** Current charge of the load capacitor, 0…1. */
  get charge(): number {
    return chargeLevel(this.ctx.playback.value(this.outNet), this.ctx.playback.transition(this.outNet));
  }

  update(pxPerUnit: number, alpha: number): void {
    for (const l of this.labels) l.fit(pxPerUnit, alpha);
    this.updateGauge(alpha);
    const inputs: Record<string, Bit> = {};
    for (const [p, net] of this.inputNets) inputs[p] = this.ctx.playback.value(net);
    const key = Object.values(inputs).join('');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const r = evaluateSwitches(this.netlist, inputs);
    this.on = r.on;
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

  /** The gauge fills from the bottom as the output's wire charges up. */
  private updateGauge(alpha: number): void {
    if (!this.layout.cap || !this.gaugeFill) return;
    const [x0, y0, x1, y1] = this.layout.cap.gauge;
    const c = this.charge;
    const fill = Math.max(c, 0.001) * (y1 - y0);
    this.gaugeFill.visible = c > 0.005 && alpha > 0.5;
    this.gaugeFill.scale.set(x1 - x0, fill, 1);
    this.gaugeFill.position.set((x0 + x1) / 2, -(y1 - fill / 2), -0.01);
  }

  /** Transistor or capacitor at a point in inner coordinates (y down). */
  hit(x: number, y: number, tol: number): InnerHit | null {
    for (const f of this.layout.fets) {
      if (Math.abs(x - (f.x + 0.3)) <= 1.1 + tol && Math.abs(y - f.y) <= f.half + tol) {
        const gate = this.ctx.playback.value(this.inputNets.find(([p]) => p === f.input)![1]);
        return { kind: 'fet', fet: f, on: !!this.on[f.id], gate };
      }
    }
    const { cap } = this.layout;
    if (!cap) return null;
    const [, gy0, gx1, gy1] = cap.gauge;
    if (x >= cap.plateTop[0][0] - tol && x <= gx1 + tol && y >= gy0 - tol && y <= gy1 + tol) {
      return { kind: 'cap', charge: this.charge };
    }
    return null;
  }

  dispose(): void {
    for (const [net, w] of this.wires) {
      if (net !== null) this.ctx.nets.remove(net, w);
      w.dispose();
    }
    for (const l of this.labels) l.dispose();
    this.gaugeGeom.dispose();
  }
}

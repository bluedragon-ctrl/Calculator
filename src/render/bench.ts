// Lab bench (DESIGN.md §7.2): one component with clickable input switches and output lamps.
// Inputs on the left or top get switches; outputs on the right or bottom get lamps.
// A `clk` input gets a clock source instead of a switch: clicking it is one tick (§5.3).
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { minPinGap, pinPos } from '../circuits/geometry';
import { busValue } from '../sim/bus';
import { flatten, type Circuit } from '../sim/flatten';
import { inputPins, outputPins, type Library } from '../sim/library';
import { CLOCK_PIN, Simulator } from '../sim/simulator';
import type { Bit, ComponentDef, Point } from '../sim/types';
import { Label } from './labels';
import { fitView, FADE_SEC, type Bounds } from './lod';
import { BLOOM_BOOST, LABEL, WIRE_OFF, WIRE_ON } from './palette';
import { Playback } from './playback';
import type { View } from './stage';
import { ComponentView, distToPolyline, NetWires, type Hit, type SiliconMode, type ViewContext, type ViewRect } from './views';
import { makeLine, Wire, type WireMaterials } from './wires';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { CrossSectionView } from './crossSection';
import { CALLOUT_ROOM } from '../circuits/crossSection';

/** Preferred world size of the component box on the bench… */
const BOX_W = 6;
const BOX_H = 4.5;
/** …but pins are never closer than this (world units), so every switch stays clickable. */
const MIN_PIN_GAP = 0.8;
/** Distance from the box to the switch column / lamp column. */
const SWITCH_GAP = 4;
const LAMP_GAP = 4;

interface Switch {
  pin: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** A switch has a sliding knob; the clock source a square-wave mark instead. */
  knob: Mesh | null;
  wave: Line2 | null;
  label: Label;
}

interface Lamp {
  pin: string;
  net: number;
  x: number;
  y: number;
  r: number;
  fill: Mesh;
  label: Label;
}

/** Things on the bench itself (outside the component) that can be hovered. */
export type BenchHit =
  | Hit
  | { kind: 'switch'; pin: string; value: Bit }
  | { kind: 'lamp'; pin: string; value: Bit }
  | { kind: 'cross'; type: 'n' | 'p'; on: boolean };

export class Bench {
  readonly object = new Group();
  readonly circuit: Circuit;
  readonly sim: Simulator;
  readonly playback: Playback;
  readonly view: ComponentView;
  readonly nets: NetWires;
  private readonly ctx: ViewContext;
  private readonly switches: Switch[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly wires: Wire[] = [];
  private readonly benchWires: { pin: string; pts: Point[] }[] = [];
  private readonly labels: Label[] = [];
  private readonly knobOn = new MeshBasicMaterial({ color: WIRE_ON });
  private readonly knobOff = new MeshBasicMaterial({ color: WIRE_OFF });
  private readonly lampOn = new MeshBasicMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST) });
  private readonly lampOff = new MeshBasicMaterial({ color: '#0c1324' });
  private readonly ringMat = new MeshBasicMaterial({ color: '#7f93c4' });
  private readonly square = new PlaneGeometry(1, 1);
  private readonly disc = new CircleGeometry(1, 32);
  private readonly bounds: [number, number, number, number];
  private cross: CrossSectionView | null = null;
  /** Clock ticks since this bench was opened. */
  ticks = 0;

  constructor(readonly def: ComponentDef, lib: Library, private readonly mats: WireMaterials, silicon: SiliconMode = { on: false }) {
    // A bench shows how its component is built, so a flip-flop (behavioural in the full
    // machine) is simulated gate by gate here.
    this.circuit = flatten(def, lib, { structural: def.simulateAs === 'behavior' });
    this.sim = new Simulator(this.circuit);
    this.playback = new Playback(Array.from({ length: this.circuit.netCount }, (_, i) => this.sim.get(i)));
    this.nets = new NetWires(this.playback);

    const pinGap = minPinGap(def);
    const unit = Math.max(Math.min(BOX_W / def.size[0], BOX_H / def.size[1]), MIN_PIN_GAP / pinGap);
    const [w, h] = [def.size[0] * unit, def.size[1] * unit];
    const left = -w / 2;
    const top = h / 2;
    this.ctx = { lib, circuit: this.circuit, mats, nets: this.nets, playback: this.playback, fadeSec: FADE_SEC, silicon };
    this.view = new ComponentView(this.ctx, def, '', left, top, unit);
    this.view.group.position.set(left, top, 0);
    this.view.group.scale.setScalar(unit);
    this.object.add(this.view.group);

    // Controls shrink with the pin spacing, so tightly packed pins still get one switch each.
    const gap = pinGap * unit;
    const swH = Math.min(1.2, gap * 0.75);
    const swW = swH * 2;
    const lampR = Math.min(0.75, gap * 0.42);
    const textSize = Math.min(0.7, gap * 0.62);
    const bounds: [number, number, number, number] = [left, -top, -left, top];
    const grow = (x0: number, y0: number, x1: number, y1: number) => {
      bounds[0] = Math.min(bounds[0], x0);
      bounds[1] = Math.min(bounds[1], y0);
      bounds[2] = Math.max(bounds[2], x1);
      bounds[3] = Math.max(bounds[3], y1);
    };
    const world = (pin: string): Point => {
      const [x, y] = pinPos(def, def.pins[pin]);
      return [left + x * unit, top - y * unit];
    };

    for (const pin of inputPins(def)) {
      const [px, py] = world(pin);
      const fromTop = def.pins[pin].side === 'top';
      const sx = fromTop ? px : left - SWITCH_GAP - swW / 2;
      const sy = fromTop ? top + 2.5 : py;
      const net = this.circuit.inputs[pin];
      this.addWire(pin, net, fromTop ? [[sx, sy - swH / 2], [px, py]] : [[sx + swW / 2, py], [px, py]]);
      this.object.add(makeLine(rect(sx, sy, swW, swH), mats.outline));
      let knob: Mesh | null = null;
      let wave: Line2 | null = null;
      if (pin === CLOCK_PIN) {
        // Square wave: low, rise, high, fall, low.
        const [x0, x1, y0, y1] = [sx - swW * 0.36, sx + swW * 0.36, sy - swH * 0.25, sy + swH * 0.25];
        const xa = x0 + (x1 - x0) * 0.3;
        const xb = x0 + (x1 - x0) * 0.7;
        wave = makeLine([[x0, y0], [xa, y0], [xa, y1], [xb, y1], [xb, y0], [x1, y0]], mats.outline, 0.05);
        this.object.add(wave);
      } else {
        knob = new Mesh(this.square, this.knobOff);
        knob.scale.set(swH * 0.8, swH * 0.8, 1);
        knob.position.set(sx, sy, 0.05);
        this.object.add(knob);
      }
      const label = fromTop
        ? new Label('', sx, sy + swH / 2 + 0.25, { size: textSize, anchorY: 'bottom', color: LABEL })
        : new Label('', sx - swW / 2 - 0.3, sy, { size: textSize, anchorX: 'right', color: LABEL });
      this.object.add(label.text);
      this.labels.push(label);
      this.switches.push({ pin, x: sx, y: sy, w: swW, h: swH, knob, wave, label });
      if (fromTop) grow(sx - swW, sy, sx + swW, sy + swH / 2 + 0.3 + textSize * 1.5);
      else grow(sx - swW / 2 - 0.3 - textSize * 4, sy, sx, sy);
    }
    for (const pin of outputPins(def)) {
      const [px, py] = world(pin);
      const below = def.pins[pin].side === 'bottom';
      const lx = below ? px : -left + LAMP_GAP;
      const ly = below ? -top - 2.5 : py;
      const net = this.circuit.outputs[pin];
      this.addWire(pin, net, below ? [[px, py], [lx, ly + lampR]] : [[px, py], [lx - lampR, py]]);
      const ring = new Mesh(this.disc, this.ringMat);
      ring.scale.setScalar(lampR * 1.2);
      ring.position.set(lx, ly, -0.02);
      const fill = new Mesh(this.disc, this.lampOff);
      fill.scale.setScalar(lampR);
      fill.position.set(lx, ly, 0.03);
      const label = below
        ? new Label('', lx, ly - lampR * 1.2 - 0.25, { size: textSize, anchorY: 'top', color: LABEL })
        : new Label('', lx + lampR * 1.2 + 0.4, ly, { size: textSize, anchorX: 'left', color: LABEL });
      this.object.add(ring, fill, label.text);
      this.labels.push(label);
      this.lamps.push({ pin, net, x: lx, y: ly, r: lampR, fill, label });
      if (below) grow(lx - 2, ly - lampR * 1.2 - 0.3 - textSize * 1.5, lx + 2, ly);
      else grow(lx, ly, lx + lampR * 1.2 + 0.4 + textSize * 4.5, ly);
    }
    this.bounds = bounds;
    this.refreshControls();
  }

  /** The view that frames the whole bench, for a canvas with this aspect ratio (width / height). */
  homeView(aspect: number): View {
    let [l, b, r, t] = this.bounds;
    if (this.cross) {
      const [cl, cb, cr] = this.cross.worldBounds;
      [l, b, r] = [Math.min(l, cl), Math.min(b, cb), Math.max(r, cr)];
    }
    // Extra room at the top for the breadcrumb bar.
    return fitView([l - 1, b - 1, r + 1, t + 1 + (t - b) * 0.06] as Bounds, aspect, 1.08);
  }

  /** A single-transistor bench can show its cross-section (DESIGN.md §6.2a). */
  get hasCrossSection(): boolean {
    return !!this.def.cmos && !this.def.cmos.pullDown;
  }

  get crossSectionShown(): boolean {
    return !!this.cross;
  }

  /** Show or hide the side view below the bench. */
  setCrossSection(on: boolean): void {
    if (!this.hasCrossSection || on === !!this.cross) return;
    if (on) {
      const scale = 0.85;
      const [l, b, r] = this.bounds;
      const w = (20 + CALLOUT_ROOM) * scale;
      this.cross = new CrossSectionView(this.def.cmos!.upType ?? 'p', this.mats, (l + r) / 2 - w / 2, b - 3, scale);
      this.object.add(this.cross.group);
    } else {
      this.object.remove(this.cross!.group);
      this.cross!.dispose();
      this.cross = null;
    }
  }

  /** The transistor of a single-transistor bench conducts (as displayed). */
  private get conducting(): boolean {
    const g = this.playback.value(this.circuit.inputs[inputPins(this.def)[0]]);
    return (this.def.cmos!.upType ?? 'p') === 'n' ? g === 1 : g === 0;
  }

  setSlowMotion(msPerDelta: number): void {
    this.playback.msPerDelta = msPerDelta;
  }

  /** Crossfade duration for zoom levels (0 = instant, for reduced motion). */
  setFade(sec: number): void {
    this.ctx.fadeSec = sec;
  }

  /** The input switch under a world point, if any (its label counts too). */
  switchAt(x: number, y: number): string | null {
    for (const s of this.switches) {
      const labelW = s.y === s.label.text.position.y ? s.w * 1.6 : 0;
      if (x >= s.x - s.w / 2 - labelW && x <= s.x + s.w / 2 && Math.abs(y - s.y) <= s.h / 2 + 0.08) return s.pin;
    }
    return null;
  }

  /** Handle a click: flips the switch under the point. Returns true if something was clicked. */
  click(x: number, y: number): boolean {
    const pin = this.switchAt(x, y);
    if (pin) this.toggle(pin);
    return !!pin;
  }

  /** Re-apply materials after a quality change. */
  refreshAll(): void {
    this.refresh();
  }

  get inputs(): string[] {
    return this.switches.map((s) => s.pin);
  }

  /** True when the component has a clock input (the clock bar can step it). */
  get hasClock(): boolean {
    return this.circuit.inputs[CLOCK_PIN] !== undefined;
  }

  /** Displayed value of the clock wire (it pulses 0 → 1 → 0 on every tick). */
  get clockValue(): Bit {
    const net = this.circuit.inputs[CLOCK_PIN];
    return net === undefined ? 0 : this.playback.value(net);
  }

  /** Call `fn` whenever the displayed clock rises (also when playing instantly). */
  onClockRise(fn: () => void): () => void {
    const net = this.circuit.inputs[CLOCK_PIN];
    return this.playback.listen((n, v) => {
      if (n === net && v === 1) fn();
    });
  }

  /** One clock tick: the clock input pulses and the flip-flops load (DESIGN.md §5.3). */
  tick(): void {
    if (!this.hasClock) return;
    this.ticks++;
    this.playback.push(this.sim.tick());
    this.refreshControls();
  }

  /** Flip an input switch. The clock source does not toggle: clicking it is one tick. */
  toggle(pin: string): void {
    if (pin === CLOCK_PIN) this.tick();
    else this.setInputs({ [pin]: this.sim.input(pin) ? 0 : 1 });
  }

  /** Value shown on an input control (for the clock: the displayed pulse). */
  inputValue(pin: string): Bit {
    return pin === CLOCK_PIN ? this.clockValue : this.sim.input(pin);
  }

  /** Change several inputs at once: one settle, one timeline (e.g. a whole 8-bit number). */
  setInputs(values: Record<string, Bit>): void {
    for (const [pin, v] of Object.entries(values)) this.sim.setInput(pin, v);
    this.playback.push(this.sim.settle());
    this.refreshControls();
  }

  /** Current value of an input bus (from the switches) or an output bus (as displayed). */
  bus(name: string): { value: number; bits: Bit[] } {
    const bus = this.def.buses![name];
    const isInput = this.def.pins[bus.pins[0]].dir === 'in';
    return busValue(bus, (p) => (isInput ? this.sim.input(p) : this.playback.value(this.circuit.outputs[p])));
  }

  /** Displayed value of an output pin (changes once the signal has arrived). */
  outputValue(pin: string): Bit {
    return this.playback.value(this.circuit.outputs[pin]);
  }

  update(dtMs: number, view: ViewRect): void {
    this.playback.update(dtMs);
    this.view.update(view, dtMs / 1000);
    this.nets.update();
    this.refreshControls();
    if (this.cross) {
      const g = this.playback.value(this.circuit.inputs[inputPins(this.def)[0]]);
      this.cross.update(g, this.outputValue(outputPins(this.def)[0]), this.conducting, view.pxPerWorld);
    }
  }

  /** Re-apply materials after a quality change. */
  refresh(): void {
    this.lampOn.color.copy(WIRE_ON).multiplyScalar(this.mats.current === 'high' ? BLOOM_BOOST : 1);
    this.nets.syncAll();
  }

  /** What is under a world point: a bench switch or lamp, a wire to them, or part of the component. */
  hit(x: number, y: number, tol: number): BenchHit | null {
    const sw = this.switchAt(x, y);
    if (sw) return { kind: 'switch', pin: sw, value: this.inputValue(sw) };
    for (const l of this.lamps) {
      if (Math.hypot(x - l.x, y - l.y) <= l.r * 1.2 + tol) return { kind: 'lamp', pin: l.pin, value: this.outputValue(l.pin) };
    }
    const inside = this.view.hit(x, y, tol);
    if (inside) return inside;
    if (this.cross?.contains(x, y)) return { kind: 'cross', type: this.def.cmos!.upType ?? 'p', on: this.conducting };
    for (const w of this.benchWires) {
      if (distToPolyline([x, y], w.pts) <= tol) {
        const isIn = this.def.pins[w.pin].dir === 'in';
        return isIn
          ? { kind: 'switch', pin: w.pin, value: this.inputValue(w.pin) }
          : { kind: 'lamp', pin: w.pin, value: this.outputValue(w.pin) };
      }
    }
    return null;
  }

  private refreshControls(): void {
    for (const s of this.switches) {
      const v = this.inputValue(s.pin);
      if (s.knob) {
        s.knob.material = v ? this.knobOn : this.knobOff;
        s.knob.position.x = s.x + (v ? 1 : -1) * (s.w / 2 - s.h / 2);
      }
      if (s.wave) s.wave.material = v ? this.mats.on : this.mats.outline;
      s.label.content = `${s.pin.toUpperCase()} = ${v}`;
    }
    for (const l of this.lamps) {
      const v = this.playback.value(l.net);
      l.fill.material = v ? this.lampOn : this.lampOff;
      l.label.content = `${l.pin.toUpperCase()} = ${v}`;
    }
  }

  private addWire(pin: string, net: number, pts: Point[]): void {
    const w = new Wire(pts, this.mats, 1);
    this.object.add(w.object);
    this.nets.add(net, w);
    this.wires.push(w);
    this.benchWires.push({ pin, pts });
  }

  dispose(): void {
    this.cross?.dispose();
    this.view.dispose();
    for (const w of this.wires) w.dispose();
    for (const s of this.switches) s.wave?.geometry.dispose();
    for (const l of this.labels) l.dispose();
    this.square.dispose();
    this.disc.dispose();
    for (const m of [this.knobOn, this.knobOff, this.lampOn, this.lampOff, this.ringMat]) m.dispose();
  }
}

function rect(cx: number, cy: number, w: number, h: number): Point[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

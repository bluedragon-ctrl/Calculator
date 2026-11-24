// Lab bench (DESIGN.md §7.2): one component with clickable input switches and output lamps.
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { pinPos } from '../circuits/geometry';
import { flatten, type Circuit } from '../sim/flatten';
import { inputPins, outputPins, type Library } from '../sim/library';
import { Simulator } from '../sim/simulator';
import type { Bit, ComponentDef, Point } from '../sim/types';
import { Label } from './labels';
import { BLOOM_BOOST, LABEL, WIRE_OFF, WIRE_ON } from './palette';
import { Playback } from './playback';
import type { View } from './stage';
import { ComponentView, NetWires, type ViewRect } from './views';
import { makeLine, Wire, type WireMaterials } from './wires';

/** Largest world width / height of the component box on the bench. */
const BOX_W = 6;
const BOX_H = 4.5;
const SWITCH_X = -11;
const LAMP_X = 10;
const SW_W = 2.4;
const SW_H = 1.2;

interface Switch {
  pin: string;
  x: number;
  y: number;
  knob: Mesh;
  label: Label;
}

interface Lamp {
  pin: string;
  net: number;
  fill: Mesh;
  label: Label;
}

export class Bench {
  readonly object = new Group();
  readonly circuit: Circuit;
  readonly sim: Simulator;
  readonly playback: Playback;
  readonly view: ComponentView;
  private readonly nets: NetWires;
  private readonly switches: Switch[] = [];
  private readonly lamps: Lamp[] = [];
  private readonly wires: Wire[] = [];
  private readonly labels: Label[] = [];
  private readonly knobOn = new MeshBasicMaterial({ color: WIRE_ON });
  private readonly knobOff = new MeshBasicMaterial({ color: WIRE_OFF });
  private readonly lampOn = new MeshBasicMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST) });
  private readonly lampOff = new MeshBasicMaterial({ color: '#0c1324' });
  private readonly geoms = [new PlaneGeometry(SW_H * 0.8, SW_H * 0.8), new CircleGeometry(0.75, 32)];
  private readonly height: number;

  constructor(readonly def: ComponentDef, lib: Library, private readonly mats: WireMaterials) {
    this.circuit = flatten(def, lib);
    this.sim = new Simulator(this.circuit);
    this.playback = new Playback(Array.from({ length: this.circuit.netCount }, (_, i) => this.sim.get(i)));
    this.nets = new NetWires(this.playback);

    const unit = Math.min(BOX_W / def.size[0], BOX_H / def.size[1]);
    this.height = def.size[1] * unit;
    const left = (-def.size[0] * unit) / 2;
    const top = this.height / 2;
    this.view = new ComponentView(
      { lib, circuit: this.circuit, mats, nets: this.nets, playback: this.playback },
      def, '', left, top, unit,
    );
    this.view.group.position.set(left, top, 0);
    this.view.group.scale.setScalar(unit);
    this.object.add(this.view.group);

    const world = (pin: string): Point => {
      const [x, y] = pinPos(def, def.pins[pin]);
      return [left + x * unit, top - y * unit];
    };

    for (const pin of inputPins(def)) {
      const [px, py] = world(pin);
      this.addWire(this.circuit.inputs[pin], [[SWITCH_X + SW_W / 2, py], [px, py]]);
      this.object.add(makeLine(rect(SWITCH_X, py, SW_W, SW_H), mats.outline));
      const knob = new Mesh(this.geoms[0], this.knobOff);
      knob.position.set(SWITCH_X, py, 0.05);
      const label = new Label('', SWITCH_X - SW_W / 2 - 0.4, py, { size: 0.7, anchorX: 'right', color: LABEL });
      this.object.add(knob, label.text);
      this.labels.push(label);
      this.switches.push({ pin, x: SWITCH_X, y: py, knob, label });
    }
    for (const pin of outputPins(def)) {
      const [px, py] = world(pin);
      const net = this.circuit.outputs[pin];
      this.addWire(net, [[px, py], [LAMP_X - 0.75, py]]);
      const ring = new Mesh(new CircleGeometry(0.9, 32), new MeshBasicMaterial({ color: '#7f93c4' }));
      ring.position.set(LAMP_X, py, -0.02);
      const fill = new Mesh(this.geoms[1], this.lampOff);
      fill.position.set(LAMP_X, py, 0.03);
      const label = new Label('', LAMP_X + 1.3, py, { size: 0.7, anchorX: 'left', color: LABEL });
      this.object.add(ring, fill, label.text);
      this.labels.push(label);
      this.lamps.push({ pin, net, fill, label });
    }
    this.refreshControls();
  }

  /** The view that frames the whole bench, for a canvas with this aspect ratio (width / height). */
  homeView(aspect: number): View {
    const left = SWITCH_X - SW_W / 2 - 4.5;
    const right = LAMP_X + 4.5;
    return { cx: (left + right) / 2, cy: 0, height: Math.max((right - left) / aspect, this.height + 8) };
  }

  setSlowMotion(msPerDelta: number): void {
    this.playback.msPerDelta = msPerDelta;
  }

  /** The input switch under a world point, if any. */
  switchAt(x: number, y: number): string | null {
    for (const s of this.switches) {
      if (Math.abs(x - s.x) <= SW_W / 2 + 2.6 && Math.abs(y - s.y) <= SW_H / 2 + 0.1) return s.pin;
    }
    return null;
  }

  get inputs(): string[] {
    return this.switches.map((s) => s.pin);
  }

  toggle(pin: string): void {
    const v: Bit = this.sim.input(pin) ? 0 : 1;
    this.sim.setInput(pin, v);
    this.playback.push(this.sim.settle());
    this.refreshControls();
  }

  update(dtMs: number, view: ViewRect): void {
    this.playback.update(dtMs);
    this.view.update(view);
    this.nets.update();
    this.refreshControls();
  }

  /** Re-apply materials after a quality change. */
  refresh(): void {
    this.lampOn.color.copy(WIRE_ON).multiplyScalar(this.mats.current === 'high' ? BLOOM_BOOST : 1);
    this.nets.syncAll();
  }

  private refreshControls(): void {
    for (const s of this.switches) {
      const v = this.sim.input(s.pin);
      s.knob.material = v ? this.knobOn : this.knobOff;
      s.knob.position.x = s.x + (v ? 1 : -1) * (SW_W / 2 - SW_H / 2);
      s.label.content = `${s.pin.toUpperCase()} = ${v}`;
    }
    for (const l of this.lamps) {
      const v = this.playback.value(l.net);
      l.fill.material = v ? this.lampOn : this.lampOff;
      l.label.content = `${l.pin.toUpperCase()} = ${v}`;
    }
  }

  private addWire(net: number, pts: Point[]): void {
    const w = new Wire(pts, this.mats, 1);
    this.object.add(w.object);
    this.nets.add(net, w);
    this.wires.push(w);
  }

  dispose(): void {
    this.view.dispose();
    for (const w of this.wires) w.dispose();
    for (const l of this.labels) l.dispose();
    for (const g of this.geoms) g.dispose();
    for (const m of [this.knobOn, this.knobOff, this.lampOn, this.lampOff]) m.dispose();
  }
}

function rect(cx: number, cy: number, w: number, h: number): Point[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

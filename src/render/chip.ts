// Chip world of the whole calculator (DESIGN.md §6.2): the calculator chip, a column of key
// buttons whose wires are the key lines, the clock source, and the display wired to the chip's
// segment outputs. Driven by the headless Machine (circuits/machine.ts).
import { CircleGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { pinPos } from '../circuits/geometry';
import { KEY_LABELS, type Machine } from '../circuits/machine';
import type { Library } from '../sim/library';
import { CLOCK_PIN } from '../sim/simulator';
import type { Bit, ComponentDef, Point } from '../sim/types';
import { blockCaptions } from '../content/calculator';
import { Label } from './labels';
import { EXPAND_PX, fitView, FADE_SEC, screenSize, type Bounds } from './lod';
import { BLOOM_BOOST, LABEL, LABEL_DIM, WIRE_ON } from './palette';
import { Playback } from './playback';
import { segmentRects, SEGMENTS } from './segments';
import type { View } from './stage';
import { ComponentView, distToPolyline, NetWires, type Hit, type ViewContext, type ViewRect } from './views';
import { makeLine, Wire, type WireMaterials } from './wires';

/** World units per inner unit of the calculator chip. */
const UNIT = 0.25;
const KEY_W = 2.6;
const KEY_H = 1.1;
const KEY_PITCH = 1.45;

interface KeyButton {
  code: number;
  x: number;
  y: number;
  label: Label;
  fill: Mesh;
}

export type ChipHit =
  | Hit
  | { kind: 'key'; code: number; value: Bit; queued: boolean }
  | { kind: 'clock'; value: Bit }
  | { kind: 'display' };

export class ChipView {
  readonly object = new Group();
  readonly playback: Playback;
  readonly nets: NetWires;
  readonly view: ComponentView;
  readonly def: ComponentDef;
  private readonly ctx: ViewContext;
  private readonly keys: KeyButton[] = [];
  private readonly extraWires: { net: number; wire: Wire; pts: Point[]; kind: 'key' | 'clock' | 'display'; code?: number }[] = [];
  private readonly labels: Label[] = [];
  private readonly lines: Line2[] = [];
  private readonly square = new PlaneGeometry(1, 1);
  private readonly disc = new CircleGeometry(1, 32);
  private readonly keyOff = new MeshBasicMaterial({ color: '#142038' });
  private readonly keyOn = new MeshBasicMaterial({ color: WIRE_ON.clone().multiplyScalar(0.55) });
  private readonly segOn = new MeshBasicMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST) });
  private readonly segOff = new MeshBasicMaterial({ color: '#141d33' });
  private readonly segments: { mesh: Mesh; net: number }[] = [];
  private readonly mLamp: { mesh: Mesh; net: number; label: Label };
  private readonly clock: { x: number; y: number; w: number; h: number; wave: Line2 };
  private readonly displayRect: Bounds;
  private readonly captions: { label: Label; bounds: Bounds }[] = [];
  private readonly bounds: Bounds;

  constructor(readonly machine: Machine, lib: Library, private readonly mats: WireMaterials) {
    this.def = lib.get('Calculator');
    const { circuit, sim } = machine;
    this.playback = new Playback(Array.from({ length: circuit.netCount }, (_, i) => sim.get(i)));
    this.nets = new NetWires(this.playback);
    this.ctx = { lib, circuit, mats, nets: this.nets, playback: this.playback, fadeSec: FADE_SEC };
    const [w, h] = this.def.size;
    const left = (-w * UNIT) / 2;
    const top = (h * UNIT) / 2;
    const right = -left;
    this.view = new ComponentView(this.ctx, this.def, '', left, top, UNIT);
    this.view.group.position.set(left, top, 0);
    this.view.group.scale.setScalar(UNIT);
    this.object.add(this.view.group);
    const pin = (p: string): Point => {
      const [x, y] = pinPos(this.def, this.def.pins[p]);
      return [left + x * UNIT, top - y * UNIT];
    };

    // --- Key buttons: one column, in the order of their pins (so the wires fan out neatly) ---
    const order = Array.from({ length: 16 }, (_, k) => k).sort((a, b) => pin(`k${b}`)[1] - pin(`k${a}`)[1]);
    const colX = left - 14;
    const midY = order.reduce((s, k) => s + pin(`k${k}`)[1], 0) / 16;
    const firstY = midY + (KEY_PITCH * 15) / 2;
    order.forEach((code, i) => {
      const x = colX;
      const y = firstY - i * KEY_PITCH;
      const [px, py] = pin(`k${code}`);
      // Jogs at different x so no two key lines run along each other.
      const jx = colX + KEY_W / 2 + 1.5 + (py > y ? 15 - i : i) * 0.45;
      const pts: Point[] = [[x + KEY_W / 2, y], [jx, y], [jx, py], [px, py]];
      this.addWire(circuit.inputs[`k${code}`], pts, 'key', code);
      this.lines.push(makeLine(rect(x, y, KEY_W, KEY_H), mats.outline));
      const fill = new Mesh(this.square, this.keyOff);
      fill.scale.set(KEY_W * 0.94, KEY_H * 0.9, 1);
      fill.position.set(x, y, -0.02);
      const label = new Label(KEY_LABELS[code], x, y, { size: KEY_H * 0.62, color: LABEL });
      this.object.add(fill, label.text);
      this.labels.push(label);
      this.keys.push({ code, x, y, label, fill });
    });
    const keysTitle = new Label('Keys', colX, firstY + 1.6, { size: 0.8, color: LABEL_DIM });
    this.object.add(keysTitle.text);
    this.labels.push(keysTitle);

    // --- Clock source, below the keys ---
    {
      const cw = KEY_W;
      const ch = KEY_H * 1.2;
      const cx = colX;
      const cy = firstY - 16 * KEY_PITCH - 1.2;
      const [px, py] = pin(CLOCK_PIN);
      const jx = colX + KEY_W / 2 + 1.5 + 16 * 0.45;
      this.addWire(circuit.inputs[CLOCK_PIN], [[cx + cw / 2, cy], [jx, cy], [jx, py], [px, py]], 'clock');
      this.lines.push(makeLine(rect(cx, cy, cw, ch), mats.outline));
      const [x0, x1, y0, y1] = [cx - cw * 0.36, cx + cw * 0.36, cy - ch * 0.25, cy + ch * 0.25];
      const xa = x0 + (x1 - x0) * 0.3;
      const xb = x0 + (x1 - x0) * 0.7;
      const wave = makeLine([[x0, y0], [xa, y0], [xa, y1], [xb, y1], [xb, y0], [x1, y0]], mats.outline, 0.05);
      this.object.add(wave);
      const lb = new Label('clock', cx, cy - ch / 2 - 0.5, { size: 0.6, color: LABEL_DIM });
      this.object.add(lb.text);
      this.labels.push(lb);
      this.clock = { x: cx, y: cy, w: cw, h: ch, wave };
    }

    // --- Display, wired to the segment outputs ---
    const outPins = Object.keys(this.def.pins).filter((p) => this.def.pins[p].dir === 'out');
    const ys = outPins.map((p) => pin(p)[1]);
    const dx = right + 4;
    const dTop = Math.max(...ys) + 2.5;
    const dBot = Math.min(...ys) - 2.5;
    const dW = 16;
    for (const p of outPins) {
      const [px, py] = pin(p);
      this.addWire(circuit.outputs[p], [[px, py], [dx, py]], 'display');
    }
    this.lines.push(makeLine([[dx, dBot], [dx + dW, dBot], [dx + dW, dTop], [dx, dTop], [dx, dBot]], mats.outline));
    const dTitle = new Label('Display', dx + dW / 2, dTop + 0.8, { size: 0.8, color: LABEL_DIM });
    this.object.add(dTitle.text);
    this.labels.push(dTitle);
    this.displayRect = [dx, dBot, dx + dW, dTop];
    // Four positions: sign, hundreds, tens, ones.
    const digitW = 2.6;
    const digitH = 4.6;
    const gap = 0.9;
    const x0 = dx + (dW - (4 * digitW + 3 * gap)) / 2;
    const y0 = (dTop + dBot) / 2 + digitH / 2;
    const positions: [string, string[]][] = [['sg', ['g']], ['h', SEGMENTS], ['t', SEGMENTS], ['o', SEGMENTS]];
    positions.forEach(([prefix, segs], i) => {
      const rects = segmentRects(digitW, digitH);
      for (const s of SEGMENTS) {
        const pinName = prefix === 'sg' ? 'sg' : `${prefix}${s}`;
        if (!segs.includes(s)) continue;
        const [cx, cy, sw, sh] = rects[s];
        const m = new Mesh(this.square, this.segOff);
        m.scale.set(sw * 0.9, sh * 0.9, 1);
        m.position.set(x0 + i * (digitW + gap) + cx, y0 - cy, 0.02);
        this.object.add(m);
        this.segments.push({ mesh: m, net: circuit.outputs[pinName] });
      }
    });
    {
      const m = new Mesh(this.disc, this.segOff);
      m.scale.setScalar(0.45);
      m.position.set(x0 + 0.3, y0 + 1.1, 0.02);
      const label = new Label('M', x0 + 1.0, y0 + 1.1, { size: 0.7, anchorX: 'left', color: LABEL_DIM });
      this.object.add(m, label.text);
      this.labels.push(label);
      this.mLamp = { mesh: m, net: circuit.outputs.mInd, label };
    }
    for (const l of this.lines) this.object.add(l);

    // Captions above the blocks, so the overview reads like a block diagram (DESIGN.md §2).
    for (const [name, part] of Object.entries(this.def.parts!)) {
      const cdef = lib.get(part.type);
      const x0 = left + part.at[0] * UNIT;
      const y0 = top - part.at[1] * UNIT;
      const bw = cdef.size[0] * UNIT;
      const label = new Label(blockCaptions[name] ?? cdef.title, x0 + bw / 2, y0 + 0.15, {
        size: name === 'const0' || name === 'mlamp' ? 0.5 : 0.85, anchorY: 'bottom', color: LABEL, minPx: 6, maxWidth: Math.max(bw + 0.6, 3),
      });
      this.object.add(label.text);
      this.captions.push({ label, bounds: [x0, y0 - cdef.size[1] * UNIT, x0 + bw, y0] });
    }

    this.bounds = [colX - KEY_W, Math.min(dBot, this.clock.y - 2, -top), dx + dW + 1, Math.max(dTop + 1.5, firstY + 2.5, top)];
    this.refresh();
  }

  /** The view that frames the whole chip world. */
  homeView(aspect: number): View {
    const [l, b, r, t] = this.bounds;
    return fitView([l, b, r, t + (t - b) * 0.06] as Bounds, aspect, 1.06);
  }

  setSlowMotion(msPerDelta: number): void {
    this.playback.msPerDelta = msPerDelta;
  }

  setFade(sec: number): void {
    this.ctx.fadeSec = sec;
  }

  get hasClock(): boolean {
    return true;
  }

  get ticks(): number {
    return this.machine.ticks;
  }

  get clockValue(): Bit {
    return this.playback.value(this.machine.circuit.inputs[CLOCK_PIN]);
  }

  onClockRise(fn: () => void): () => void {
    const net = this.machine.circuit.inputs[CLOCK_PIN];
    return this.playback.listen((n, v) => {
      if (n === net && v === 1) fn();
    });
  }

  /** Press a key (queued by the machine when busy). */
  press(code: number): void {
    const t = this.machine.press(code);
    if (t) this.playback.push(t);
  }

  tick(): void {
    this.playback.push(this.machine.tick());
  }

  /** Run the calculator until it is idle (Instant mode / device level). */
  runUntilIdle(): void {
    let n = 0;
    while (this.machine.busy && n++ < 1000) this.tick();
  }

  /** Displayed value of an output pin. */
  outputValue(pin: string): Bit {
    return this.playback.value(this.machine.circuit.outputs[pin]);
  }

  update(dtMs: number, view: ViewRect): void {
    this.playback.update(dtMs);
    this.view.update(view, dtMs / 1000);
    this.nets.update();
    this.refresh();
    // Captions fade out once their block opens (it then shows its own title).
    for (const c of this.captions) {
      const open = screenSize(c.bounds, view.pxPerWorld) > EXPAND_PX;
      c.label.fit(view.pxPerWorld, open ? 0 : 1);
    }
  }

  refresh(): void {
    this.segOn.color.copy(WIRE_ON).multiplyScalar(this.mats.current === 'high' ? BLOOM_BOOST : 1);
    const lines = this.machine.circuit.inputs;
    for (const k of this.keys) {
      const on = this.playback.value(lines[`k${k.code}`]) === 1;
      k.fill.material = on ? this.keyOn : this.keyOff;
    }
    this.clock.wave.material = this.clockValue ? this.mats.on : this.mats.outline;
    for (const s of this.segments) s.mesh.material = this.playback.value(s.net) ? this.segOn : this.segOff;
    const m = this.playback.value(this.mLamp.net);
    this.mLamp.mesh.material = m ? this.segOn : this.segOff;
    this.mLamp.label.text.color = m ? LABEL : LABEL_DIM;
  }

  /** Re-sync wires after a quality change. */
  refreshAll(): void {
    this.nets.syncAll();
    this.refresh();
  }

  /** Key code under a world point, if any. */
  keyAt(x: number, y: number): number | null {
    for (const k of this.keys) {
      if (Math.abs(x - k.x) <= KEY_W / 2 && Math.abs(y - k.y) <= KEY_H / 2 + 0.08) return k.code;
    }
    return null;
  }

  clockAt(x: number, y: number): boolean {
    const c = this.clock;
    return Math.abs(x - c.x) <= c.w / 2 && Math.abs(y - c.y) <= c.h / 2;
  }

  /** Handle a click: a key press or a clock tick. Returns true if something was clicked. */
  click(x: number, y: number): boolean {
    const k = this.keyAt(x, y);
    if (k !== null) {
      this.press(k);
      return true;
    }
    if (this.clockAt(x, y)) {
      this.tick();
      return true;
    }
    return false;
  }

  hit(x: number, y: number, tol: number): ChipHit | null {
    const lines = this.machine.circuit.inputs;
    const k = this.keyAt(x, y);
    if (k !== null) return { kind: 'key', code: k, value: this.playback.value(lines[`k${k}`]), queued: this.machine.queue.includes(k) };
    if (this.clockAt(x, y)) return { kind: 'clock', value: this.clockValue };
    const [l, b, r, t] = this.displayRect;
    if (x >= l && x <= r && y >= b && y <= t) return { kind: 'display' };
    const inside = this.view.hit(x, y, tol);
    if (inside) return inside;
    for (const w of this.extraWires) {
      if (distToPolyline([x, y], w.pts) > tol) continue;
      if (w.kind === 'key') return { kind: 'key', code: w.code!, value: this.playback.value(w.net), queued: false };
      if (w.kind === 'clock') return { kind: 'clock', value: this.clockValue };
      return { kind: 'display' };
    }
    return null;
  }

  private addWire(net: number, pts: Point[], kind: 'key' | 'clock' | 'display', code?: number): void {
    const wire = new Wire(pts, this.mats, 1);
    this.object.add(wire.object);
    this.nets.add(net, wire);
    this.extraWires.push({ net, wire, pts, kind, code });
  }

  dispose(): void {
    this.view.dispose();
    for (const w of this.extraWires) {
      this.nets.remove(w.net, w.wire);
      w.wire.dispose();
    }
    for (const l of this.lines) l.geometry.dispose();
    this.clock.wave.geometry.dispose();
    for (const l of this.labels) l.dispose();
    for (const c of this.captions) c.label.dispose();
    this.square.dispose();
    this.disc.dispose();
    for (const m of [this.keyOff, this.keyOn, this.segOn, this.segOff]) m.dispose();
  }
}

function rect(cx: number, cy: number, w: number, h: number): Point[] {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
}

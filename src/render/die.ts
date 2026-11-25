// Die view of the calculator chip ("Real chip" at chip level, DESIGN.md §6.2a, Phase 4c).
//
// The chip drawn as a stylised silicon die (circuits/dieLayout.ts): one region per block, area to
// scale with its transistors, each block's pattern baked into one texture. Bond pads sit on the
// edge, and bond wires run to the package pins where the key, clock and display wires arrive;
// the bond wires are ordinary signal wires, so they light up and carry sparks.
//
// A block glows while it is switching: a faint wash and a thick bright outline (shape and
// brightness, not colour alone; never above 1.0, so it does not bloom). Labels sit on top with a
// dark outline and are never bloomed.
//
// Coordinates: the chip's inner frame (y down), flipped to y up inside `group`.
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { dieLayout, type DieLayout } from '../circuits/dieLayout';
import { innerScale } from '../circuits/geometry';
import type { Rect } from '../circuits/siliconLayout';
import { blockCaptions } from '../content/calculator';
import { dieText } from '../content/silicon';
import type { Circuit } from '../sim/flatten';
import type { Library } from '../sim/library';
import type { ComponentDef, Point } from '../sim/types';
import { paintDie, paintRegion, rasterSize, toTexture } from './dieArt';
import { Label } from './labels';
import { DIE_ACTIVE, LABEL, LABEL_DIM } from './palette';
import type { Playback } from './playback';
import { Raster } from './raster';
import type { NetWires } from './views';
import { makeLine, Wire, type WireMaterials } from './wires';

/** Texture density of the blocks (pixels per chip unit) and of the die base. */
const BLOCK_PX = 9;
const BASE_PX = 4;
/** How long a block keeps glowing after its last change (seconds). */
const GLOW_SEC = 0.5;
/** Largest block label (chip units): as big as the block-diagram captions. */
const LABEL_SIZE = 3.6;

const PLANE = new PlaneGeometry(1, 1);

const rectLine = ([x0, y0, x1, y1]: Rect): Point[] => [[x0, -y0], [x1, -y0], [x1, -y1], [x0, -y1], [x0, -y0]];
const inRect = ([x0, y0, x1, y1]: Rect, x: number, y: number, tol = 0) =>
  x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol;

interface Block {
  part: string;
  rect: Rect;
  mat: MeshBasicMaterial;
  wash: MeshBasicMaterial;
  washMesh: Mesh;
  outline: Line2;
  active: Line2;
  label: Label;
  glow: number;
}

export type DieHit =
  | { kind: 'block'; part: string }
  | { kind: 'pad'; pin: string; net: number }
  | { kind: 'die' };

export class DieView {
  readonly group = new Group();
  readonly layout: DieLayout;
  private readonly blocks: Block[] = [];
  private readonly mats: MeshBasicMaterial[] = [];
  private readonly lines: Line2[] = [];
  private readonly labels: Label[] = [];
  private readonly bonds: { net: number; wire: Wire; pin: string; pts: Point[] }[] = [];
  private readonly stopListening: () => void;
  private alpha = 0;
  private readonly fade = () => this.alpha;

  /**
   * @param worldScale world units per chip unit (for wire and spark sizes)
   */
  constructor(
    def: ComponentDef,
    lib: Library,
    circuit: Circuit,
    playback: Playback,
    private readonly nets: NetWires,
    mats: WireMaterials,
    worldScale: number,
  ) {
    const layout = dieLayout(def, lib);
    this.layout = layout;
    this.group.visible = false;

    // The die base: silicon, pad ring and bond pads.
    {
      const [w, h] = rasterSize(layout.die, BASE_PX);
      const r = new Raster(w, h, layout.die);
      paintDie(r, layout, lib, false);
      this.addPlane(layout.die, toTexture(r), 0);
    }

    // One texture per block, plus its outline, glow and label.
    for (const reg of layout.regions) {
      const [w, h] = rasterSize(reg.rect, BLOCK_PX);
      const r = new Raster(w, h, reg.rect);
      paintRegion(r, reg, lib);
      const mat = this.addPlane(reg.rect, toTexture(r), 0.01);
      const wash = new MeshBasicMaterial({ color: DIE_ACTIVE, transparent: true, opacity: 0, depthWrite: false });
      this.mats.push(wash);
      const washMesh = new Mesh(PLANE, wash);
      place(washMesh, reg.rect, 0.02);
      washMesh.visible = false;
      this.group.add(washMesh);
      const outline = makeLine(rectLine(reg.rect), mats.frame, 0.03, this.fade);
      const active = makeLine(rectLine(reg.rect), mats.active, 0.04, this.fade);
      active.visible = false;
      this.group.add(outline, active);
      this.lines.push(outline, active);
      const [x0, y0, x1, y1] = reg.rect;
      const bw = x1 - x0;
      const bh = y1 - y0;
      const name = blockCaptions[reg.part] ?? lib.get(reg.type).title;
      // Tall, narrow blocks get their name written upwards, along the block.
      const upright = bh > bw * 1.6;
      const [along, across] = upright ? [bh, bw] : [bw, bh];
      const label = new Label(name, (x0 + x1) / 2, -(y0 + y1) / 2, {
        size: Math.min(LABEL_SIZE, across * 0.55, (along * 1.6) / Math.max(name.length, 4)),
        maxWidth: along * 0.92, color: LABEL, outline: true, minPx: 6,
      });
      label.text.position.z = 0.3;
      if (upright) label.text.rotation.z = Math.PI / 2;
      this.group.add(label.text);
      this.labels.push(label);
      this.blocks.push({ part: reg.part, rect: reg.rect, mat, wash, washMesh, outline, active, label, glow: 0 });
    }

    // Bond wires: pad → package pin, carrying the pin's signal.
    for (const p of layout.pads) {
      const net = circuit.pinNet.get(p.pin);
      if (net === undefined) continue;
      const pts: Point[] = [p.bond[0], p.bond[1]];
      const wire = new Wire(pts.map(([x, y]) => [x, -y] as Point), mats, worldScale, this.fade);
      wire.object.position.z = 0.05;
      this.group.add(wire.object);
      nets.add(net, wire);
      this.bonds.push({ net, wire, pin: p.pin, pts });
    }

    // The honest note, under the die.
    const [dx0, , dx1] = layout.die;
    const note = new Label(dieText.note, (dx0 + dx1) / 2, -(def.size[1] * innerScale(def) + 1.5), { size: 3.6, color: LABEL_DIM, anchorY: 'top' });
    this.group.add(note.text);
    this.labels.push(note);

    // Which block drives each net, so a block can glow while its wires change.
    const blockOf = new Map(this.blocks.map((b, i) => [b.part, i]));
    const byNet: number[] = new Array(circuit.netCount).fill(-1);
    for (let n = 0; n < circuit.netCount; n++) {
      const g = circuit.driver[n];
      if (g < 0) continue;
      byNet[n] = blockOf.get(circuit.gates[g].path.split('.')[0]) ?? -1;
    }
    this.stopListening = playback.listen((net) => {
      const b = byNet[net];
      if (b >= 0) this.blocks[b].glow = 1;
    });
  }

  private addPlane(rect: Rect, map: MeshBasicMaterial['map'], z: number): MeshBasicMaterial {
    const mat = new MeshBasicMaterial({ map, transparent: true, depthWrite: false });
    this.mats.push(mat);
    const m = new Mesh(PLANE, mat);
    place(m, rect, z);
    this.group.add(m);
    return mat;
  }

  /** Blocks glowing right now (for tests). */
  get glowing(): string[] {
    return this.blocks.filter((b) => b.glow > 0).map((b) => b.part);
  }

  get opacity(): number {
    return this.alpha;
  }

  /**
   * @param alpha 0 = hidden … 1 = fully shown
   * @param pxPerUnit screen pixels per chip unit
   */
  update(dtSec: number, alpha: number, pxPerUnit: number): void {
    this.alpha = alpha;
    const shown = alpha > 0.004;
    this.group.visible = shown;
    for (const b of this.blocks) {
      b.glow = Math.max(0, b.glow - dtSec / GLOW_SEC);
    }
    if (!shown) return;
    for (const m of this.mats) if (m.map) m.opacity = alpha;
    for (const b of this.blocks) {
      b.wash.opacity = 0.22 * b.glow * alpha;
      b.washMesh.visible = b.glow > 0.01;
      b.active.visible = b.glow > 0.05;
    }
    for (const l of this.labels) l.fit(pxPerUnit, alpha);
  }

  /** What is at a point of the chip's inner frame (y down). */
  hit(x: number, y: number, tol: number): DieHit | null {
    for (const b of this.bonds) {
      const pad = this.layout.pads.find((p) => p.pin === b.pin)!;
      if (inRect(pad.rect, x, y, tol) || distToSegment([x, y], b.pts[0], b.pts[1]) <= tol) {
        return { kind: 'pad', pin: b.pin, net: b.net };
      }
    }
    for (const b of this.blocks) if (inRect(b.rect, x, y)) return { kind: 'block', part: b.part };
    return inRect(this.layout.die, x, y) ? { kind: 'die' } : null;
  }

  dispose(): void {
    this.stopListening();
    for (const b of this.bonds) {
      this.nets.remove(b.net, b.wire);
      b.wire.dispose();
    }
    for (const m of this.mats) {
      m.map?.dispose();
      m.dispose();
    }
    for (const l of this.lines) l.geometry.dispose();
    for (const l of this.labels) l.dispose();
  }
}

function place(m: Mesh, [x0, y0, x1, y1]: Rect, z: number): void {
  m.position.set((x0 + x1) / 2, -(y0 + y1) / 2, z);
  m.scale.set(x1 - x0, y1 - y0, 1);
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Table view of a ROM or PLA (DESIGN.md §4.3, §6.4: "active PLA rule / ROM row: highlighted row").
// The table is drawn once into a canvas texture (cheap even for 256 rows); the active rows get
// a bright outline and a ▶ marker, so they stand out by shape and brightness, not colour alone.
import {
  CanvasTexture, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace,
} from 'three';
import { innerSize, pinPos, innerScale } from '../circuits/geometry';
import type { Bit, ComponentDef, Point } from '../sim/types';
import { inputPins } from '../sim/library';
import type { AlphaFn } from './fade';
import { Wire, makeLine, type WireMaterials } from './wires';
import type { Line2 } from 'three/addons/lines/Line2.js';

/** Font for canvas text: the bundled Inter (declared in style.css), with a system fallback. */
const FONT = `'Inter', system-ui, sans-serif`;
const ROW_PX = 30;
const PAD_PX = 12;

interface Layout {
  /** Rows per block (long tables are split into side-by-side blocks). */
  perBlock: number;
  blocks: number;
  colPx: number[];
  blockPx: number;
  widthPx: number;
  heightPx: number;
}

/** Split long tables into side-by-side blocks so the table's shape fits the available area best. */
function measure(def: ComponentDef, availW: number, availH: number): Layout {
  let best: Layout | null = null;
  let bestK = 0;
  for (let b = 1; b <= 8; b++) {
    const L = measureBlocks(def, b);
    const k = Math.min(availW / L.widthPx, availH / L.heightPx);
    if (k > bestK) {
      best = L;
      bestK = k;
    }
  }
  return best!;
}

function measureBlocks(def: ComponentDef, blocks: number): Layout {
  const t = def.table!;
  const perBlock = Math.ceil(t.rows.length / blocks);
  const c = document.createElement('canvas').getContext('2d')!;
  c.font = `600 ${ROW_PX * 0.62}px ${FONT}`;
  const colPx = t.columns.map((h, i) => {
    let w = c.measureText(h).width;
    for (const r of t.rows) w = Math.max(w, c.measureText(r[i]).width);
    return Math.ceil(w) + 22;
  });
  const blockPx = colPx.reduce((a, b) => a + b, 0) + 30; // + room for the ▶ marker
  return {
    perBlock, blocks, colPx, blockPx,
    widthPx: blocks * blockPx + PAD_PX * 2,
    heightPx: (perBlock + 1) * ROW_PX + PAD_PX * 2,
  };
}

function draw(def: ComponentDef, L: Layout): HTMLCanvasElement {
  const t = def.table!;
  const canvas = document.createElement('canvas');
  canvas.width = L.widthPx;
  canvas.height = L.heightPx;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#0a1120';
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.textBaseline = 'middle';
  for (let b = 0; b < L.blocks; b++) {
    const x0 = PAD_PX + b * L.blockPx + 30;
    let x = x0;
    c.font = `600 ${ROW_PX * 0.6}px ${FONT}`;
    c.fillStyle = '#7f8fb3';
    t.columns.forEach((h, i) => {
      c.fillText(h, x + 8, PAD_PX + ROW_PX / 2);
      x += L.colPx[i];
    });
    c.font = `600 ${ROW_PX * 0.62}px ${FONT}`;
    for (let k = 0; k < L.perBlock; k++) {
      const r = b * L.perBlock + k;
      if (r >= t.rows.length) break;
      const y = PAD_PX + (k + 1) * ROW_PX;
      if (k % 2 === 0) {
        c.fillStyle = '#0e1628';
        c.fillRect(x0, y, L.blockPx - 30, ROW_PX);
      }
      c.fillStyle = '#c9d6f2';
      x = x0;
      t.rows[r].forEach((cell, i) => {
        c.fillText(cell, x + 8, y + ROW_PX / 2);
        x += L.colPx[i];
      });
    }
    c.strokeStyle = '#26324e';
    c.lineWidth = 2;
    c.strokeRect(x0, PAD_PX + ROW_PX, L.blockPx - 30, L.perBlock * ROW_PX);
  }
  return canvas;
}

export class TableView {
  readonly group = new Group();
  private readonly texture: CanvasTexture;
  private readonly plane: Mesh;
  private readonly planeMat: MeshBasicMaterial;
  private readonly geom = new PlaneGeometry(1, 1);
  private readonly L: Layout;
  /** Inner units per canvas pixel, and the table's top-left corner in inner units. */
  private readonly k: number;
  private readonly origin: Point;
  private readonly marks: { outline: Line2; arrow: Line2 }[] = [];
  private readonly wires: [number, Wire][] = [];
  private lastKey = '';
  /** Rows active right now. */
  active: number[] = [];

  constructor(
    private readonly def: ComponentDef,
    private readonly mats: WireMaterials,
    addNetWire: (net: number, w: Wire) => void,
    private readonly netOfPin: (pin: string) => number,
    private readonly value: (net: number) => Bit,
    worldScale: number,
    private readonly fade: AlphaFn,
  ) {
    const [W, H] = innerSize(def);
    // Leave room for the pin names on both sides.
    const mx = W * 0.1;
    const my = H * 0.04;
    this.L = measure(def, W - 2 * mx, H - 2 * my);
    const k = Math.min((W - 2 * mx) / this.L.widthPx, (H - 2 * my) / this.L.heightPx);
    this.k = k;
    const w = this.L.widthPx * k;
    const h = this.L.heightPx * k;
    this.origin = [(W - w) / 2, (H - h) / 2];

    this.texture = new CanvasTexture(draw(def, this.L));
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.minFilter = LinearFilter;
    this.texture.generateMipmaps = false;
    this.planeMat = new MeshBasicMaterial({ map: this.texture, transparent: true });
    this.plane = new Mesh(this.geom, this.planeMat);
    this.plane.scale.set(w, h, 1);
    this.plane.position.set(this.origin[0] + w / 2, -(this.origin[1] + h / 2), -0.05);
    this.group.add(this.plane);
    // Redraw once the bundled font has loaded, so the text uses it.
    document.fonts?.load(`600 20px Inter`).then(() => {
      if (!this.texture.image) return;
      this.texture.image = draw(def, this.L);
      this.texture.needsUpdate = true;
    }).catch(() => {});

    // Pin wires from the frame's edge to the table.
    const s = innerScale(def);
    for (const [pin, pd] of Object.entries(def.pins)) {
      const [px, py] = pinPos(def, pd);
      const p: Point = [px * s, py * s];
      const edge = pd.side === 'left' ? this.origin[0] : this.origin[0] + w;
      const wire = new Wire([[p[0], -p[1]], [edge, -p[1]]], mats, worldScale, fade);
      this.group.add(wire.object);
      const net = netOfPin(pin);
      addNetWire(net, wire);
      this.wires.push([net, wire]);
    }
  }

  /** Wires drawn by the table (to unregister on dispose). */
  get netWires(): [number, Wire][] {
    return this.wires;
  }

  /** Inner-unit rectangle of a row: [x0, y0, x1, y1] (y down). */
  rowRect(r: number): [number, number, number, number] {
    const b = Math.floor(r / this.L.perBlock);
    const k = r % this.L.perBlock;
    const x0 = this.origin[0] + (PAD_PX + b * this.L.blockPx + 30) * this.k;
    const y0 = this.origin[1] + (PAD_PX + (k + 1) * ROW_PX) * this.k;
    return [x0, y0, x0 + (this.L.blockPx - 30) * this.k, y0 + ROW_PX * this.k];
  }

  update(alpha: number): void {
    this.planeMat.opacity = alpha;
    this.planeMat.visible = alpha > 0.004;
    const ins = inputPins(this.def).map((p) => this.value(this.netOfPin(p)));
    const key = ins.join('');
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.active = this.def.table!.active(ins);
    for (const m of this.marks) {
      this.group.remove(m.outline, m.arrow);
      m.outline.geometry.dispose();
      m.arrow.geometry.dispose();
    }
    this.marks.length = 0;
    for (const r of this.active) {
      const [x0, y0, x1, y1] = this.rowRect(r);
      const outline = makeLine([[x0, -y0], [x1, -y0], [x1, -y1], [x0, -y1], [x0, -y0]], this.mats.on, 0.05, this.fade);
      const a = (y1 - y0) * 0.4;
      const cy = (y0 + y1) / 2;
      const ax = x0 - a * 0.4;
      const arrow = makeLine([[ax - a * 1.6, -(cy - a)], [ax, -cy], [ax - a * 1.6, -(cy + a)], [ax - a * 1.6, -(cy - a)]], this.mats.on, 0.05, this.fade);
      this.group.add(outline, arrow);
      this.marks.push({ outline, arrow });
    }
  }

  dispose(): void {
    for (const [, w] of this.wires) w.dispose();
    for (const m of this.marks) {
      m.outline.geometry.dispose();
      m.arrow.geometry.dispose();
    }
    this.texture.dispose();
    this.planeMat.dispose();
    this.geom.dispose();
  }
}

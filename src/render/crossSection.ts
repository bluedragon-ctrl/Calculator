// The single-transistor bench's cross-section (DESIGN.md §6.2a, Phase 4b): the transistor cut
// open and seen from the side. The gate, the power side and the lamp side light up with their
// values; when the transistor conducts, a glowing channel joins the two islands under the gate.
import { Color, Group } from 'three';
import type { Line2 } from 'three/addons/lines/Line2.js';
import { CALLOUT_ROOM, crossSection, type CrossSection } from '../circuits/crossSection';
import type { Rect } from '../circuits/siliconLayout';
import { crossText as T } from '../content/silicon';
import type { Bit, Point } from '../sim/types';
import { Label } from './labels';
import {
  CHANNEL_ON, CONTACT_COLOR, DIFF_COLOR, LABEL, LABEL_DIM, METAL_COLOR, POLY_COLOR, WELL_COLOR,
} from './palette';
import { Fill } from './silicon';
import { makeLine, type WireMaterials } from './wires';

const SUBSTRATE = new Color('#2b3346');
const OXIDE = new Color('#d7e0ee');
const COLORS = {
  substrate: SUBSTRATE, well: WELL_COLOR, sourceDrain: DIFF_COLOR, channel: CHANNEL_ON, oxide: OXIDE,
  poly: POLY_COLOR, contact: CONTACT_COLOR, metal: METAL_COLOR,
};
const Z = { substrate: -0.04, well: -0.03, sourceDrain: 0, channel: 0.02, oxide: 0.01, poly: 0.01, contact: 0.015, metal: 0.02 };

const rectLine = ([x0, y0, x1, y1]: Rect): Point[] => [[x0, -y0], [x1, -y0], [x1, -y1], [x0, -y1], [x0, -y0]];

export class CrossSectionView {
  readonly group = new Group();
  readonly cs: CrossSection;
  private readonly lit: { terminal: 'gate' | 'power' | 'lamp'; fill: Fill; outline: Line2 | null }[] = [];
  private readonly fills: Fill[] = [];
  private readonly labels: Label[] = [];
  private readonly channelFill: Fill;
  private readonly channelLine: Line2;
  private readonly channelLabel: Label;
  private on = false;

  /** @param scale world units per cross-section unit; (x, top) = world position of its top-left corner */
  constructor(type: 'n' | 'p', private readonly mats: WireMaterials, readonly x: number, readonly top: number, readonly scale: number) {
    this.cs = crossSection(type);
    this.group.position.set(x, top, 0);
    this.group.scale.setScalar(scale);
    for (const s of this.cs.shapes) {
      const f = new Fill(s.rect, COLORS[s.part], Z[s.part], s.part === 'oxide' ? 0.85 : 1);
      f.setLit(s.part === 'substrate' || s.part === 'well' || s.part === 'oxide' || s.part === 'contact');
      this.group.add(f.mesh);
      this.fills.push(f);
      if (s.part === 'channel') continue;
      if (s.terminal) {
        const outline = s.part === 'contact' ? null : makeLine(rectLine(s.rect), mats.off, Z[s.part] + 0.005);
        if (outline) this.group.add(outline);
        this.lit.push({ terminal: s.terminal, fill: f, outline });
      }
    }
    const ch = this.cs.shapes.find((s) => s.part === 'channel')!;
    this.channelFill = this.fills[this.cs.shapes.indexOf(ch)];
    this.channelFill.setLit(true);
    this.channelLine = makeLine(rectLine(ch.rect), mats.channelOff, 0.03);
    this.group.add(this.channelLine);
    for (const l of this.cs.labels) {
      const lb = new Label(T[l.key as 'power' | 'gate' | 'lamp'], l.at[0], -l.at[1], { size: 0.5 });
      this.group.add(lb.text);
      this.labels.push(lb);
    }
    let channelLabel: Label | null = null;
    for (const c of this.cs.callouts) {
      const text = c.key === 'regions' ? T.regions(type) : c.key === 'channel' ? '' : T[c.key as 'oxide' | 'substrate' | 'well'];
      const lb = new Label(text, c.at[0], -c.at[1], { size: 0.5, anchorX: 'left', color: LABEL });
      this.group.add(lb.text, makeLine([[c.target[0], -c.target[1]], [c.at[0] - 0.3, -c.at[1]]], mats.outline, 0.1));
      this.labels.push(lb);
      if (c.key === 'channel') channelLabel = lb;
    }
    this.channelLabel = channelLabel!;
    const heading = new Label(T.heading, 0, 0.6, { size: 0.55, anchorX: 'left', anchorY: 'bottom', color: LABEL_DIM });
    this.group.add(heading.text);
    this.labels.push(heading);
    const [w, h] = [this.cs.width, this.cs.height];
    this.group.add(makeLine(rectLine([0, 0, w, h]), mats.frame, -0.1));
  }

  /** World bounds [left, bottom, right, top], heading included. */
  get worldBounds(): [number, number, number, number] {
    return [this.x, this.top - this.cs.height * this.scale, this.x + (this.cs.width + CALLOUT_ROOM) * this.scale, this.top + 1.4 * this.scale];
  }

  contains(x: number, y: number): boolean {
    const [l, b, r, t] = this.worldBounds;
    return x >= l && x <= r && y >= b && y <= t;
  }

  get conducting(): boolean {
    return this.on;
  }

  /** `gate` and `lamp` are the displayed values of the bench's input and output. */
  update(gate: Bit, lamp: Bit, conducting: boolean, pxPerWorld: number): void {
    for (const l of this.labels) l.fit(pxPerWorld * this.scale);
    this.on = conducting;
    const value = { gate, power: 1, lamp } as const;
    for (const p of this.lit) {
      const v = value[p.terminal];
      p.fill.setLit(v === 1);
      if (p.outline) p.outline.material = v ? this.mats.on : this.mats.off;
    }
    this.channelFill.show(conducting);
    this.channelFill.fade(1);
    for (const f of this.fills) if (f !== this.channelFill) f.fade(1);
    this.channelLine.material = conducting ? this.mats.channelOn : this.mats.channelOff;
    this.channelLabel.content = conducting ? T.channelOn : T.channelOff;
    this.channelLabel.text.color = conducting ? LABEL : LABEL_DIM;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if ((o as Line2).isLine2) (o as Line2).geometry.dispose();
    });
    for (const f of this.fills) f.dispose();
    for (const l of this.labels) l.dispose();
  }
}

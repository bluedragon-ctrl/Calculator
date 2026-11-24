// Neon wire rendering (DESIGN.md §6.4). Phase 0: one Line2 per wire with shared
// materials; later phases will batch geometry per component definition.
import { AdditiveBlending, Group, LessDepth, Vector2 } from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Quality } from '../ui/quality';
import {
  BLOOM_BOOST, GLOW_OPACITY, GLOW_WIDTH, WIRE_OFF, WIRE_ON, WIRE_WIDTH_OFF, WIRE_WIDTH_ON,
} from './palette';

export type Bit = 0 | 1;
export type Point = readonly [number, number];

/** Materials shared by all wires; switching quality only touches these. */
export class WireMaterials {
  readonly off: LineMaterial;
  readonly on: LineMaterial;
  readonly glow: LineMaterial;
  private quality: Quality = 'high';

  constructor() {
    this.off = new LineMaterial({ color: WIRE_OFF, linewidth: WIRE_WIDTH_OFF });
    this.on = new LineMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST), linewidth: WIRE_WIDTH_ON });
    this.glow = new LineMaterial({
      color: WIRE_ON,
      linewidth: GLOW_WIDTH,
      transparent: true,
      opacity: GLOW_OPACITY,
      blending: AdditiveBlending,
      // Depth-write so overlapping segments/caps of one glow don't stack into blobs.
      depthWrite: true,
      depthFunc: LessDepth,
    });
  }

  setResolution(width: number, height: number): void {
    const r = new Vector2(width, height);
    for (const m of [this.off, this.on, this.glow]) m.resolution.copy(r);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    // High: push "on" above 1.0 so the bloom pass picks it up.
    // Low: no post-processing, so keep it in range and fake glow with a wide line.
    this.on.color.copy(WIRE_ON).multiplyScalar(q === 'high' ? BLOOM_BOOST : 1);
  }

  get current(): Quality {
    return this.quality;
  }

  dispose(): void {
    this.off.dispose();
    this.on.dispose();
    this.glow.dispose();
  }
}

export class Wire {
  readonly object = new Group();
  readonly points: readonly Point[];
  readonly length: number;
  private readonly core: Line2;
  private readonly glow: Line2;
  private value: Bit = 0;

  constructor(points: readonly Point[], private readonly mats: WireMaterials) {
    if (points.length < 2) throw new Error('A wire needs at least two points');
    this.points = points;
    const geom = new LineGeometry();
    geom.setPositions(points.flatMap(([x, y]) => [x, y, 0]));
    this.core = new Line2(geom, mats.off);
    this.glow = new Line2(geom, mats.glow);
    this.glow.position.z = -0.05;
    this.glow.visible = false;
    this.object.add(this.glow, this.core);
    let len = 0;
    for (let i = 1; i < points.length; i++) {
      len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    this.length = len;
  }

  get bit(): Bit {
    return this.value;
  }

  setValue(v: Bit): void {
    this.value = v;
    this.refresh();
  }

  /** Re-apply materials after a quality change. */
  refresh(): void {
    this.core.material = this.value ? this.mats.on : this.mats.off;
    this.glow.visible = this.value === 1 && this.mats.current === 'low';
  }

  /** Position at fraction t (0..1) along the polyline. */
  pointAt(t: number): Point {
    let remaining = Math.min(Math.max(t, 0), 1) * this.length;
    for (let i = 1; i < this.points.length; i++) {
      const [x0, y0] = this.points[i - 1];
      const [x1, y1] = this.points[i];
      const seg = Math.hypot(x1 - x0, y1 - y0);
      if (remaining <= seg || i === this.points.length - 1) {
        const f = seg === 0 ? 0 : Math.min(remaining / seg, 1);
        return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
      }
      remaining -= seg;
    }
    return this.points[this.points.length - 1];
  }

  dispose(): void {
    this.core.geometry.dispose();
  }
}

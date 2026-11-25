// Neon wire rendering (DESIGN.md §6.4). One Line2 per wire with shared materials.
// A change travels along the wire as a front (new value behind it) led by a spark.
import {
  AdditiveBlending, CircleGeometry, Color, Group, LessDepth, Mesh, MeshBasicMaterial, Vector2,
} from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import type { Bit, Point } from '../sim/types';
import type { Quality } from '../ui/quality';
import { fadeObject, type AlphaFn } from './fade';
import type { Transition } from './playback';
import {
  BLOOM_BOOST, CAP_COLOR, DIE_ACTIVE, CHANNEL_ON, CHARGE, FRAME, GLOW_OPACITY, GLOW_WIDTH, GND_COLOR, OUTLINE, OUTLINE_WIDTH,
  PATH_GND, PATH_VDD, PATH_WIDTH, SPARK_PX, VDD_COLOR, WIRE_OFF, WIRE_ON, WIRE_WIDTH_OFF,
  WIRE_WIDTH_ON,
} from './palette';

export type { Bit, Point };

/** Materials shared by everything drawn with lines; switching quality only touches these. */
export class WireMaterials {
  readonly off = new LineMaterial({ color: WIRE_OFF, linewidth: WIRE_WIDTH_OFF });
  readonly on = new LineMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST), linewidth: WIRE_WIDTH_ON });
  readonly glow = new LineMaterial({
    color: WIRE_ON,
    linewidth: GLOW_WIDTH,
    transparent: true,
    opacity: GLOW_OPACITY,
    blending: AdditiveBlending,
    // Depth-write so overlapping segments/caps of one glow don't stack into blobs.
    depthWrite: true,
    depthFunc: LessDepth,
  });
  readonly vdd = new LineMaterial({ color: VDD_COLOR, linewidth: 3.5 });
  readonly gnd = new LineMaterial({ color: GND_COLOR, linewidth: 3.5 });
  readonly outline = new LineMaterial({ color: OUTLINE, linewidth: OUTLINE_WIDTH });
  readonly frame = new LineMaterial({ color: FRAME, linewidth: 1.5 });
  /** Outline of a die block that is switching (Phase 4c): thick and bright, but ≤ 1.0 (no bloom). */
  readonly active = new LineMaterial({ color: DIE_ACTIVE.clone().multiplyScalar(0.9), linewidth: 3.5 });
  readonly channelOff = new LineMaterial({ color: WIRE_OFF, linewidth: 2, dashed: true, dashSize: 0.18, gapSize: 0.14 });
  readonly channelOn = new LineMaterial({ color: CHANNEL_ON.clone().multiplyScalar(BLOOM_BOOST), linewidth: 6 });
  readonly pathVdd = pathMaterial(PATH_VDD);
  readonly pathGnd = pathMaterial(PATH_GND);
  /** Spark meshes: bright for 0 → 1, a dim "dimming wave" for 1 → 0. */
  readonly sparkGeom = new CircleGeometry(0.5, 20);
  readonly sparkOn = new MeshBasicMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST * 2) });
  readonly sparkOff = new MeshBasicMaterial({ color: new Color('#6c7fa8') });
  readonly dot = new MeshBasicMaterial({ color: OUTLINE });
  /** Load capacitor plates and its charge gauge (§6.2a). */
  readonly cap = new LineMaterial({ color: CAP_COLOR, linewidth: 2 });
  readonly charge = new MeshBasicMaterial({ color: CHARGE.clone().multiplyScalar(0.55) });
  /** World units per CSS pixel (updated by the camera), so sparks keep a constant size. */
  worldPerPx = 0.03;
  /** When false (reduced motion), no sparks are drawn. */
  sparks = true;
  private quality: Quality = 'high';

  constructor() {
    // Transparent so the LOD crossfade can fade single objects (see fade.ts). At full opacity
    // they look exactly like opaque lines.
    for (const m of this.lineMaterials) m.transparent = true;
  }

  private get lineMaterials(): LineMaterial[] {
    return [this.off, this.on, this.glow, this.vdd, this.gnd, this.outline, this.frame, this.active,
      this.channelOff, this.channelOn, this.pathVdd, this.pathGnd, this.cap];
  }

  setResolution(width: number, height: number): void {
    const r = new Vector2(width, height);
    for (const m of this.lineMaterials) m.resolution.copy(r);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    // High: push "on" colours above 1.0 so the bloom pass picks them up.
    // Low: no post-processing, so keep them in range and fake glow with a wide line.
    const boost = q === 'high' ? BLOOM_BOOST : 1;
    this.on.color.copy(WIRE_ON).multiplyScalar(boost);
    this.channelOn.color.copy(CHANNEL_ON).multiplyScalar(boost);
    this.sparkOn.color.copy(WIRE_ON).multiplyScalar(q === 'high' ? BLOOM_BOOST * 2 : 1.6);
  }

  get current(): Quality {
    return this.quality;
  }

  dispose(): void {
    for (const m of this.lineMaterials) m.dispose();
    this.sparkGeom.dispose();
    this.sparkOn.dispose();
    this.sparkOff.dispose();
    this.dot.dispose();
    this.charge.dispose();
  }
}

function pathMaterial(c: Color): LineMaterial {
  return new LineMaterial({
    color: c, linewidth: PATH_WIDTH, transparent: true, opacity: 0.28, depthWrite: false,
  });
}

/** Build a Line2 from 2D points (y already in world orientation), optionally fading with `alpha`. */
export function makeLine(points: readonly Point[], mat: LineMaterial, z = 0, alpha?: AlphaFn): Line2 {
  const geom = new LineGeometry();
  geom.setPositions(points.flatMap(([x, y]) => [x, y, z]));
  const line = new Line2(geom, mat);
  if (mat.dashed) line.computeLineDistances();
  if (alpha) fadeObject(line, alpha);
  return line;
}

export function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return len;
}

/** Point at fraction t along a polyline, plus the index of the segment it lies on. */
export function pointAlong(points: readonly Point[], length: number, t: number): { p: Point; seg: number } {
  let remaining = Math.min(Math.max(t, 0), 1) * length;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (remaining <= seg || i === points.length - 1) {
      const f = seg === 0 ? 0 : Math.min(remaining / seg, 1);
      return { p: [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f], seg: i };
    }
    remaining -= seg;
  }
  return { p: points[points.length - 1], seg: points.length - 1 };
}

/** One drawable piece of a wire: a core line plus (low quality) a glow line. */
class Segment {
  readonly core: Line2;
  readonly glow: Line2;

  constructor(points: readonly Point[], private readonly mats: WireMaterials, z: number, alpha?: AlphaFn) {
    this.core = makeLine(points, mats.off, z, alpha);
    this.glow = new Line2(this.core.geometry, mats.glow);
    this.glow.position.z = z - 0.05;
    if (alpha) fadeObject(this.glow, alpha);
  }

  setPoints(points: readonly Point[], z: number): void {
    this.core.geometry.setPositions(points.flatMap(([x, y]) => [x, y, z]));
  }

  show(visible: boolean, v: Bit): void {
    this.core.visible = visible;
    this.core.material = v ? this.mats.on : this.mats.off;
    this.glow.visible = visible && v === 1 && this.mats.current === 'low';
  }

  dispose(): void {
    this.core.geometry.dispose();
  }
}

/** A signal wire: dim and thin at 0, bright and thick at 1. */
export class Wire {
  readonly object = new Group();
  readonly points: readonly Point[];
  readonly length: number;
  private readonly whole: Segment;
  /** While a change travels: the part already changed (front) and the part still waiting (rest). */
  private front: Segment | null = null;
  private rest: Segment | null = null;
  private spark: Mesh | null = null;
  private value: Bit = 0;
  private tr: Transition | null = null;

  /**
   * @param points polyline in the parent's local frame (world orientation, y up)
   * @param worldScale world units per local unit, so sparks keep a constant on-screen size
   */
  constructor(
    points: readonly Point[],
    private readonly mats: WireMaterials,
    private readonly worldScale = 1,
    private readonly alpha?: AlphaFn,
  ) {
    if (points.length < 2) throw new Error('A wire needs at least two points');
    this.points = points;
    this.whole = new Segment(points, mats, 0, alpha);
    this.object.add(this.whole.glow, this.whole.core);
    this.length = polylineLength(points);
    this.refresh();
  }

  get bit(): Bit {
    return this.value;
  }

  setValue(v: Bit): void {
    if (v === this.value) return;
    this.value = v;
    this.refresh();
  }

  /** Show a change in progress (or clear it with null). */
  setTransition(tr: Transition | null): void {
    this.tr = tr;
    if (!tr) {
      this.refresh();
      return;
    }
    const { p, seg } = pointAlong(this.points, this.length, tr.progress);
    const done: Point[] = [...this.points.slice(0, seg), p];
    const todo: Point[] = [p, ...this.points.slice(seg)];
    if (!this.front || !this.rest) {
      this.front = new Segment(done, this.mats, 0.01, this.alpha);
      this.rest = new Segment(todo, this.mats, 0, this.alpha);
      this.object.add(this.front.glow, this.front.core, this.rest.glow, this.rest.core);
    } else {
      this.front.setPoints(done, 0.01);
      this.rest.setPoints(todo, 0);
    }
    this.whole.show(false, tr.from);
    this.front.show(tr.progress > 0, tr.to);
    this.rest.show(tr.progress < 1, tr.from);

    if (this.mats.sparks && (this.alpha?.() ?? 1) > 0.5) {
      if (!this.spark) {
        this.spark = new Mesh(this.mats.sparkGeom, this.mats.sparkOn);
        this.object.add(this.spark);
      }
      this.spark.material = tr.to ? this.mats.sparkOn : this.mats.sparkOff;
      this.spark.scale.setScalar((SPARK_PX * this.mats.worldPerPx * (tr.to ? 1 : 0.7)) / this.worldScale);
      this.spark.position.set(p[0], p[1], 0.1);
      this.spark.visible = true;
    } else if (this.spark) {
      this.spark.visible = false;
    }
  }

  /** Re-apply materials (after a value or quality change). */
  refresh(): void {
    if (this.tr) {
      this.setTransition(this.tr);
      return;
    }
    this.whole.show(true, this.value);
    this.front?.show(false, 0);
    this.rest?.show(false, 0);
    if (this.spark) this.spark.visible = false;
  }

  dispose(): void {
    this.whole.dispose();
    this.front?.dispose();
    this.rest?.dispose();
  }
}

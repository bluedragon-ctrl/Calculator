// Phase 0 test pattern: orthogonal "circuit" wires that toggle and fire sparks.
// Exists to check bloom, line thickness and frame rate; replaced in Phase 1.
import { Group } from 'three';
import { SparkLayer } from './sparks';
import { Wire, WireMaterials, type Point } from './wires';

/** Small deterministic PRNG so the pattern is the same on every load. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TestPattern {
  readonly object = new Group();
  readonly sparks = new SparkLayer();
  readonly wires: Wire[] = [];
  private readonly rand = mulberry32(42);
  private timer = 0;

  constructor(readonly materials: WireMaterials, count = 48) {
    for (let i = 0; i < count; i++) {
      const w = new Wire(this.randomRoute(), materials);
      w.setValue(this.rand() < 0.4 ? 1 : 0);
      this.wires.push(w);
      this.object.add(w.object);
    }
    this.object.add(this.sparks.object);
  }

  /** An orthogonal route with 2–4 bends, inside a 40×20 area. */
  private randomRoute(): Point[] {
    const r = this.rand;
    let x = Math.round(r() * 40 - 20);
    let y = Math.round(r() * 20 - 10);
    const pts: Point[] = [[x, y]];
    const bends = 2 + Math.floor(r() * 3);
    let horizontal = r() < 0.5;
    for (let i = 0; i < bends; i++) {
      const d = Math.round((r() * 2 - 1) * 8) || 3;
      if (horizontal) x = Math.max(-20, Math.min(20, x + d));
      else y = Math.max(-10, Math.min(10, y + d));
      pts.push([x, y]);
      horizontal = !horizontal;
    }
    return pts;
  }

  refreshAll(): void {
    for (const w of this.wires) w.refresh();
  }

  update(dtSec: number): void {
    this.timer += dtSec;
    while (this.timer > 0.15) {
      this.timer -= 0.15;
      const w = this.wires[Math.floor(this.rand() * this.wires.length)];
      const next = w.bit ? 0 : 1;
      w.setValue(next);
      if (next) this.sparks.emit(w, 0.25 + w.length * 0.03);
    }
    this.sparks.update(dtSec);
  }
}

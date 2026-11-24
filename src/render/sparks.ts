// Sparks: a bright particle running along a wire when its value changes (DESIGN.md §6.4).
import { CircleGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { BLOOM_BOOST, WIRE_ON } from './palette';
import type { Quality } from '../ui/quality';
import type { Wire } from './wires';

interface ActiveSpark {
  mesh: Mesh;
  wire: Wire;
  age: number;
  duration: number;
}

export class SparkLayer {
  readonly object = new Group();
  private readonly geom = new CircleGeometry(0.22, 20);
  private readonly mat = new MeshBasicMaterial({ color: WIRE_ON.clone().multiplyScalar(BLOOM_BOOST * 2) });
  private readonly pool: Mesh[] = [];
  private readonly active: ActiveSpark[] = [];
  enabled = true;

  setQuality(q: Quality): void {
    this.mat.color.copy(WIRE_ON).multiplyScalar(q === 'high' ? BLOOM_BOOST * 2 : 1.6);
  }

  emit(wire: Wire, durationSec: number): void {
    if (!this.enabled) return;
    const mesh = this.pool.pop() ?? new Mesh(this.geom, this.mat);
    mesh.position.z = 0.1;
    this.object.add(mesh);
    this.active.push({ mesh, wire, age: 0, duration: durationSec });
  }

  update(dtSec: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.age += dtSec;
      const t = s.age / s.duration;
      if (t >= 1) {
        this.object.remove(s.mesh);
        this.pool.push(s.mesh);
        this.active.splice(i, 1);
        continue;
      }
      const [x, y] = s.wire.pointAt(t);
      s.mesh.position.set(x, y, 0.1);
    }
  }

  dispose(): void {
    this.geom.dispose();
    this.mat.dispose();
  }
}

// LCD close-up (device world, DESIGN.md §6.2a, Phase 4c): one display segment taken apart into
// its layers, floating beside the calculator. Opt-in.
//
// Layers, front to back, for a reflective twisted-nematic LCD as in pocket calculators:
// front polariser, glass with the segment-shaped electrode, liquid crystal, glass with the back
// electrode, back polariser with a mirror. With 0 on the segment's wire the crystal rods lie
// flat and twist through 90° (light gets through both polarisers, so the segment looks clear);
// with 1 they stand up along the electric field (light is blocked, so the segment looks dark).
// The view at the top shows the segment as you would see it.
import {
  BoxGeometry, CylinderGeometry, Group, LineBasicMaterial, LineSegments, BufferGeometry, Float32BufferAttribute,
  Mesh, MeshStandardMaterial, Quaternion, Vector3, type Object3D,
} from 'three';
import type { Text } from 'troika-three-text';
import { lcdText as T } from '../content/silicon';
import { text3d } from './text3d';

const W = 2.6;
const D = 0.8;
const GAP = 0.82;
/** Plates tip their faces towards the camera (which looks at them from slightly below). */
const TILT = 1.0;
/** Seconds for the rods to turn when the wire changes. */
const TURN_SEC = 0.25;

const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);

export class LcdCutaway {
  readonly group = new Group();
  /** Objects that answer hover (tagged `prop: 'lcd'`). */
  readonly pickables: Object3D[] = [];
  private readonly rods: { mesh: Mesh; flat: Quaternion }[] = [];
  private readonly viewSeg: Mesh;
  private readonly viewSegOn = new MeshStandardMaterial({ color: '#141922', roughness: 0.6 });
  private readonly viewSegOff = new MeshStandardMaterial({ color: '#a7b3ab', roughness: 0.6 });
  private readonly stateText: Text;
  private readonly texts: Text[] = [];
  private readonly disposables: { dispose(): void }[] = [];
  /** 0 = rods flat and twisted (wire 0) … 1 = standing up (wire 1). */
  private turn = 0;
  private on: boolean | null = null;

  constructor() {
    const g = this.group;
    const mat = (color: string, opacity = 1, metalness = 0) => {
      const m = new MeshStandardMaterial({ color, roughness: 0.4, metalness, transparent: opacity < 1, opacity });
      this.disposables.push(m);
      return m;
    };
    const plateGeom = new BoxGeometry(W, 0.06, D);
    this.disposables.push(plateGeom);
    const label = (s: string, y: number) => {
      const t = text3d(s, 0.17, '#9fb0d0', W / 2 + 0.25, y, 0);
      t.anchorX = 'left';
      t.sync();
      g.add(t);
      this.texts.push(t);
    };
    /** A plate leaning back, at height `y`. */
    const plate = (y: number, m: MeshStandardMaterial) => {
      const layer = new Group();
      layer.position.set(0, y, 0);
      layer.rotation.x = TILT;
      const mesh = new Mesh(plateGeom, m);
      mesh.userData = { prop: 'lcd' };
      this.pickables.push(mesh);
      layer.add(mesh);
      g.add(layer);
      return layer;
    };
    /** Fine parallel lines on a plate: the polariser's direction. */
    const stripes = (layer: Group, alongX: boolean) => {
      const pts: number[] = [];
      for (let i = -5; i <= 5; i++) {
        const k = (i / 5.5) * (alongX ? D / 2 : W / 2);
        if (alongX) pts.push(-W / 2 + 0.05, 0.035, k, W / 2 - 0.05, 0.035, k);
        else pts.push(k, 0.035, -D / 2 + 0.05, k, 0.035, D / 2 - 0.05);
      }
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute(pts, 3));
      const lm = new LineBasicMaterial({ color: '#c9b8ff' });
      this.disposables.push(geom, lm);
      layer.add(new LineSegments(geom, lm));
    };
    /** A segment-shaped patch on a plate (an electrode, or the segment you see). */
    const segment = (layer: Group, m: MeshStandardMaterial, w: number) => {
      const geom = new BoxGeometry(w, 0.02, 0.2);
      this.disposables.push(geom);
      const s = new Mesh(geom, m);
      s.position.y = 0.04;
      layer.add(s);
      return s;
    };

    let y = 0;
    // What you see: the segment in its window.
    const view = plate(y, mat('#8f9b94'));
    this.viewSeg = segment(view, this.viewSegOff, 1.5);
    label(T.segment, y);
    this.stateText = text3d('', 0.17, '#e6ecf8', W / 2 + 0.25, y - 0.26, 0);
    this.stateText.anchorX = 'left';
    g.add(this.stateText);
    this.texts.push(this.stateText);
    y -= GAP * 1.25;

    stripes(plate(y, mat('#3b3552', 0.55)), true);
    label(T.layers.frontPolariser, y);
    y -= GAP;

    segment(plate(y, mat('#9fc3d6', 0.3)), mat('#5fd7ff', 0.7), 1.5);
    label(T.layers.frontGlass, y);
    y -= GAP;

    // Liquid crystal: three rows from front to back; flat rows twist 0°, 45°, 90°.
    const crystal = plate(y, mat('#2a4a3a', 0.35));
    const rodGeom = new CylinderGeometry(0.035, 0.035, 0.3, 8);
    const rodMat = mat('#9dffc8');
    this.disposables.push(rodGeom);
    for (let row = 0; row < 3; row++) {
      const twist = (row * Math.PI) / 4;
      const flat = new Quaternion().setFromAxisAngle(Y_AXIS, twist).multiply(new Quaternion().setFromAxisAngle(Z_AXIS, Math.PI / 2));
      for (let col = 0; col < 5; col++) {
        const rod = new Mesh(rodGeom, rodMat);
        rod.position.set(-W / 2 + 0.35 + col * ((W - 0.7) / 4), 0.2, -D / 2 + 0.16 + row * ((D - 0.32) / 2));
        crystal.add(rod);
        this.rods.push({ mesh: rod, flat });
      }
    }
    label(T.layers.crystal, y);
    y -= GAP;

    const back = plate(y, mat('#9fc3d6', 0.3));
    const common = new Mesh(new BoxGeometry(W - 0.3, 0.02, D - 0.3), mat('#5fd7ff', 0.35));
    this.disposables.push(common.geometry);
    common.position.y = 0.04;
    back.add(common);
    label(T.layers.backGlass, y);
    y -= GAP;

    stripes(plate(y, mat('#8d95a8', 1, 0.7)), false);
    label(T.layers.backPolariser, y);

    const heading = text3d(T.heading, 0.2, '#c9d6f2', 0, 0.75, 0);
    g.add(heading);
    this.texts.push(heading);
    this.disposables.push(this.viewSegOn, this.viewSegOff);
    this.update(0, false);
  }

  /** Follow the segment's wire (`on` = 1 on the wire). */
  update(dtSec: number, on: boolean): void {
    const target = on ? 1 : 0;
    const step = dtSec / TURN_SEC;
    this.turn = this.turn < target ? Math.min(target, this.turn + step) : Math.max(target, this.turn - step);
    if (dtSec === 0) this.turn = target;
    for (const r of this.rods) r.mesh.quaternion.copy(r.flat).slerp(new Quaternion(), this.turn);
    if (on !== this.on) {
      this.on = on;
      this.viewSeg.material = on ? this.viewSegOn : this.viewSegOff;
      this.stateText.text = on ? T.stateOn : T.stateOff;
      this.stateText.sync();
    }
  }

  get rodsStanding(): number {
    return this.turn;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    for (const t of this.texts) t.dispose();
  }
}

// Device world (DESIGN.md §6.2, §6.2a): a stylised 3D pocket calculator under a perspective
// camera. Its display is driven by the simulated segments and its keys are clickable. "Look
// inside" lifts the cover to show the circuit board with real-part props; "Into the chip"
// dives into the chip package, then the chip world takes over.
import {
  AmbientLight, BoxGeometry, CircleGeometry, CylinderGeometry, DirectionalLight, Group,
  HemisphereLight, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry,
  Raycaster, RingGeometry, Scene, Vector2, Vector3, BufferGeometry, Float32BufferAttribute, LineBasicMaterial,
  LineSegments, type Object3D, type Texture, type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Text } from 'troika-three-text';
import { text3d } from './text3d';
import { KEY_LABELS } from '../circuits/machine';
import type { DieLayout } from '../circuits/dieLayout';
import { LcdCutaway } from './lcdCutaway';
import { BACKGROUND, WIRE_ON } from './palette';
import { segmentRects, SEGMENTS } from './segments';

/** Keypad layout (key codes), as on the HUD. */
const LAYOUT = [
  [7, 8, 9, 13],
  [4, 5, 6, 14],
  [1, 2, 3, 15],
  [0, 10, 11, 12],
];
const KEY_PITCH_X = 1.25;
const KEY_PITCH_Y = 1.05;
const KEYS_TOP = -0.55;
const BOARD_Z = 0.32;
const COVER_Z = 0.62;
/** The chip package's centre on the board. */
const CHIP_X = -0.5;
const CHIP_Y = 0.9;
/** Width of the die inside the package. */
const DIE_W = 1.0;
/** The dive: approach, lid off, then down onto the die (seconds in all). */
const DIVE_SEC = 2.6;
/** Where the LCD close-up floats (beside the calculator), and how far the camera moves to show it. */
const LCD_X = 5.6;
const LCD_Y = 3.4;
const LCD_SHIFT = 2.8;

/** The die art for the dive (DESIGN.md §9, Phase 4c): the chip's floorplan baked into a texture. */
export interface DieArt {
  texture: Texture;
  layout: DieLayout;
}

export type DevicePhase = 'closed' | 'opening' | 'open' | 'closing' | 'diving';

/** What the pointer is over: a key, or a board part with a tooltip id. */
export type DeviceHit = { kind: 'key'; code: number } | { kind: 'prop'; id: string };

const ease = (t: number) => t * t * (3 - 2 * t);
/** Progress of one step of the dive, eased: 0 before `from`, 1 after `from + len`. */
const part = (d: number, from: number, len: number) => ease(Math.min(1, Math.max(0, (d - from) / len)));

const text = text3d;

export class DeviceWorld {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 0.05, 200);
  private readonly cover = new Group();
  private readonly keys = new Map<number, Mesh>();
  private readonly pressedAt = new Map<number, number>();
  private readonly segs: { mesh: Mesh; pin: string }[] = [];
  private readonly mLamp: Text;
  private readonly segOn = new MeshBasicMaterial({ color: WIRE_ON });
  private readonly segOff = new MeshBasicMaterial({ color: '#16243a' });
  private readonly pickables: Object3D[] = [];
  private readonly texts: Text[] = [];
  private readonly raycaster = new Raycaster();
  private time = 0;
  /** 0 = cover closed, 1 = cover off. */
  private open = 0;
  private dive = 0;
  phase: DevicePhase = 'closed';
  /** Called once the dive into the chip has finished. */
  onDived: (() => void) | null = null;
  /** Instant camera moves and cover (prefers-reduced-motion). */
  instant = false;
  /** The package's lid (comes off during the dive) and what it covers. */
  private readonly lid = new Group();
  private readonly lidMats: MeshStandardMaterial[] = [];
  private readonly inside = new Group();
  private dieAspect = 3;
  private lcd: LcdCutaway | null = null;
  private lcdLink: LineSegments | null = null;
  private lcdWanted = false;
  /** Camera shift towards the LCD close-up: 0 … 1. */
  private lcdShift = 0;

  constructor(dieArt?: DieArt) {
    this.scene.background = BACKGROUND;
    this.scene.add(new HemisphereLight('#b9c8ff', '#0b1020', 1.1), new AmbientLight('#ffffff', 0.25));
    const sun = new DirectionalLight('#ffffff', 1.6);
    sun.position.set(-4, 6, 10);
    this.scene.add(sun);

    // --- Body (the back half) and the circuit board inside it ---
    const body = new Mesh(new RoundedBoxGeometry(6.2, 10.2, 0.7, 4, 0.25), new MeshStandardMaterial({ color: '#1b2233', roughness: 0.7 }));
    body.position.z = -0.05;
    this.scene.add(body);
    this.buildBoard();
    this.buildPackageInside(dieArt);

    // --- Cover (front shell) with a window over the display and holes for the keys ---
    const shell = new MeshStandardMaterial({ color: '#2a3247', roughness: 0.55, metalness: 0.1 });
    const parts: [number, number, number, number][] = [
      // x, y, w, h pieces of the cover around the display window
      [0, 4.6, 6.2, 1.0],
      [0, 1.25, 6.2, 1.9],
      [-2.85, 3.1, 0.5, 2.0],
      [2.85, 3.1, 0.5, 2.0],
      [0, -2.4, 6.2, 5.4],
    ];
    for (const [x, y, w, h] of parts) {
      const m = new Mesh(new BoxGeometry(w, h, 0.18), shell);
      m.position.set(x, y, COVER_Z);
      this.cover.add(m);
    }
    const glass = new Mesh(new PlaneGeometry(5.2, 2.0), new MeshStandardMaterial({ color: '#0b1222', transparent: true, opacity: 0.25, roughness: 0.1 }));
    glass.position.set(0, 3.1, COVER_Z + 0.06);
    this.cover.add(glass);
    const brand = text('INSIDE-8', 0.28, '#7f8fb3', 0, 1.6, COVER_Z + 0.1);
    this.cover.add(brand);
    this.texts.push(brand);
    // Rubber keys sit in the cover, right above their contacts on the board.
    const keyGeom = new RoundedBoxGeometry(0.95, 0.75, 0.32, 3, 0.12);
    const digitMat = new MeshStandardMaterial({ color: '#3a4560', roughness: 0.8 });
    const opMat = new MeshStandardMaterial({ color: '#1f5560', roughness: 0.8 });
    LAYOUT.forEach((row, r) => row.forEach((code, c) => {
      const [x, y] = this.keyPos(r, c);
      const k = new Mesh(keyGeom, code >= 10 ? opMat : digitMat);
      k.position.set(x, y, COVER_Z + 0.2);
      k.userData = { key: code };
      const lb = text(KEY_LABELS[code], 0.3, '#e6ecf8', 0, 0, 0.17);
      k.add(lb);
      this.texts.push(lb);
      this.cover.add(k);
      this.keys.set(code, k);
      this.pickables.push(k);
    }));
    this.scene.add(this.cover);

    // The display module lives on the board (visible through the window, and with the cover off).
    this.mLamp = text('M', 0.26, '#22304a', -2.2, 3.55, BOARD_Z + 0.2);
    this.scene.add(this.mLamp);
    this.texts.push(this.mLamp);
    this.setView(0);
  }

  private keyPos(r: number, c: number): [number, number] {
    return [(c - 1.5) * KEY_PITCH_X, KEYS_TOP - r * KEY_PITCH_Y];
  }

  /** Board, chip package and the real-part props (DESIGN.md §6.2a). */
  private buildBoard(): void {
    const prop = (m: Object3D, id: string) => {
      m.userData = { prop: id };
      this.pickables.push(m);
      this.scene.add(m);
      return m;
    };
    const pcb = new Mesh(new BoxGeometry(5.8, 9.8, 0.06), new MeshStandardMaterial({ color: '#0f4d2e', roughness: 0.6 }));
    pcb.position.z = BOARD_Z - 0.03;
    this.scene.add(pcb);
    const copper = new MeshStandardMaterial({ color: '#c89b3c', roughness: 0.35, metalness: 0.8 });

    // Display module.
    const lcd = new Mesh(new BoxGeometry(5.0, 1.8, 0.12), new MeshStandardMaterial({ color: '#070c18', roughness: 0.2 }));
    lcd.position.set(0, 3.1, BOARD_Z + 0.06);
    prop(lcd, 'display');
    const dw = 0.75;
    const dh = 1.25;
    const gap = 0.32;
    const x0 = -(4 * dw + 3 * gap) / 2 + 0.3;
    const rects = segmentRects(dw, dh);
    const plane = new PlaneGeometry(1, 1);
    ['sg', 'h', 't', 'o'].forEach((d, i) => {
      for (const s of SEGMENTS) {
        if (d === 'sg' && s !== 'g') continue;
        const [cx, cy, w, h] = rects[s];
        const m = new Mesh(plane, this.segOff);
        m.scale.set(w * 0.9, h * 0.9, 1);
        m.position.set(x0 + i * (dw + gap) + cx, 3.1 + dh / 2 - cy, BOARD_Z + 0.13);
        this.scene.add(m);
        this.segs.push({ mesh: m, pin: d === 'sg' ? 'sg' : `${d}${s}` });
      }
    });

    // Chip package (QFP) with pins: a base, and a lid with the label that comes off in the dive.
    const pkgMat = new MeshStandardMaterial({ color: '#111318', roughness: 0.5 });
    const chip = new Mesh(new BoxGeometry(1.5, 1.5, 0.1), pkgMat);
    chip.position.set(CHIP_X, CHIP_Y, BOARD_Z + 0.05);
    prop(chip, 'chip');
    const lidMat = new MeshStandardMaterial({ color: '#111318', roughness: 0.5, transparent: true });
    this.lidMats.push(lidMat);
    const lidBox = new Mesh(new BoxGeometry(1.5, 1.5, 0.08), lidMat);
    lidBox.userData = { prop: 'chip' };
    this.pickables.push(lidBox);
    this.lid.add(lidBox);
    this.lid.position.set(CHIP_X, CHIP_Y, BOARD_Z + 0.14);
    this.scene.add(this.lid);
    const pinGeom = new BoxGeometry(0.06, 0.2, 0.03);
    const pinMat = new MeshStandardMaterial({ color: '#b8bec9', metalness: 0.9, roughness: 0.3 });
    for (let i = 0; i < 8; i++) {
      const t = -0.6 + (i * 1.2) / 7;
      for (const [x, y, rot] of [[CHIP_X + t, CHIP_Y + 0.85, 0], [CHIP_X + t, CHIP_Y - 0.85, 0], [CHIP_X - 0.85, CHIP_Y + t, 1], [CHIP_X + 0.85, CHIP_Y + t, 1]] as const) {
        const p = new Mesh(pinGeom, pinMat);
        p.position.set(x, y, BOARD_Z + 0.02);
        p.rotation.z = rot ? Math.PI / 2 : 0;
        this.scene.add(p);
      }
    }
    const chipLabel = text('CALC-8\n~7000 transistors', 0.13, '#9aa3b5', 0, 0, 0.045);
    chipLabel.textAlign = 'center';
    this.lid.add(chipLabel);
    this.texts.push(chipLabel);

    // Decoupling capacitor right next to the chip (a small ceramic part with two pads).
    const cap = new Mesh(new BoxGeometry(0.42, 0.22, 0.18), new MeshStandardMaterial({ color: '#c9a66b', roughness: 0.6 }));
    cap.position.set(0.75, 1.55, BOARD_Z + 0.09);
    prop(cap, 'capacitor');

    // Coin-cell battery.
    const cell = new Mesh(new CylinderGeometry(0.7, 0.7, 0.2, 40), new MeshStandardMaterial({ color: '#c7ccd6', metalness: 0.9, roughness: 0.25 }));
    cell.rotation.x = Math.PI / 2;
    cell.position.set(1.85, 0.9, BOARD_Z + 0.1);
    prop(cell, 'battery');
    const plus = text('+ 3V', 0.2, '#5b6272', 1.85, 0.9, BOARD_Z + 0.21);
    this.scene.add(plus);
    this.texts.push(plus);

    // Pull-down resistors on the key lines: a row of small banded parts between keypad and chip.
    const resBody = new CylinderGeometry(0.07, 0.07, 0.36, 12);
    const resMat = new MeshStandardMaterial({ color: '#d8c7a0', roughness: 0.7 });
    const bandMat = new MeshStandardMaterial({ color: '#6b3a1e' });
    for (let i = 0; i < 8; i++) {
      const g = new Group();
      const r = new Mesh(resBody, resMat);
      g.add(r);
      for (const off of [-0.09, 0, 0.09]) {
        const band = new Mesh(new CylinderGeometry(0.075, 0.075, 0.03, 12), bandMat);
        band.position.y = off;
        g.add(band);
      }
      g.position.set(-2.1 + i * 0.6, -0.05, BOARD_Z + 0.08);
      g.rotation.z = 0;
      g.userData = { prop: 'resistor' };
      this.pickables.push(g);
      this.scene.add(g);
    }

    // Keypad contacts (two interleaved combs drawn as rings) and the traces to the chip.
    LAYOUT.forEach((row, r) => row.forEach((_code, c) => {
      const [x, y] = this.keyPos(r, c);
      const outer = new Mesh(new RingGeometry(0.26, 0.33, 28), copper);
      outer.position.set(x, y, BOARD_Z + 0.005);
      const inner = new Mesh(new CircleGeometry(0.15, 24), copper);
      inner.position.set(x, y, BOARD_Z + 0.005);
      prop(outer, 'contacts');
      prop(inner, 'contacts');
    }));
    const traceMat = new MeshStandardMaterial({ color: '#2f7a4b', roughness: 0.5 });
    for (let c = 0; c < 4; c++) {
      const x = (c - 1.5) * KEY_PITCH_X + 0.42;
      const t = new Mesh(new BoxGeometry(0.05, 4.4, 0.01), traceMat);
      t.position.set(x, -1.95, BOARD_Z + 0.002);
      prop(t, 'trace');
    }
    for (let i = 0; i < 8; i++) {
      const x = -2.1 + i * 0.6;
      const t = new Mesh(new BoxGeometry(0.04, 0.75, 0.01), traceMat);
      t.position.set(x, 0.4, BOARD_Z + 0.002);
      prop(t, 'trace');
    }
    const bus = new Mesh(new BoxGeometry(4.3, 0.04, 0.01), traceMat);
    bus.position.set(-0.0, 0.75 - 0.05, BOARD_Z + 0.002);
    prop(bus, 'trace');
  }

  /**
   * Under the lid: the cavity with the die (the chip's floorplan, same as the chip world's die
   * view) and gold bond wires from its pads to the lead fingers at the cavity's edge.
   */
  private buildPackageInside(art?: DieArt): void {
    const z = BOARD_Z + 0.1;
    const cavity = new Mesh(new PlaneGeometry(1.36, 1.36), new MeshStandardMaterial({ color: '#2b2a26', roughness: 0.7 }));
    cavity.position.set(CHIP_X, CHIP_Y, z + 0.001);
    this.inside.add(cavity);
    if (!art) {
      this.scene.add(this.inside);
      return;
    }
    const L = art.layout;
    const [dx0, dy0, dx1, dy1] = L.die;
    this.dieAspect = (dx1 - dx0) / (dy1 - dy0);
    const k = DIE_W / (dx1 - dx0);
    const dieH = (dy1 - dy0) * k;
    // Die (y down in layout units → y up on the board).
    const die = new Mesh(new PlaneGeometry(DIE_W, dieH), new MeshBasicMaterial({ map: art.texture }));
    die.position.set(CHIP_X, CHIP_Y, z + 0.004);
    die.userData = { prop: 'die' };
    this.pickables.push(die);
    this.inside.add(die);
    const toBoard = ([x, y]: readonly [number, number]) =>
      [CHIP_X + (x - (dx0 + dx1) / 2) * k, CHIP_Y - (y - (dy0 + dy1) / 2) * k] as const;
    // Lead fingers on the cavity's left and right edges, one per bond wire, in pad order.
    const pts: number[] = [];
    const fingers = new Group();
    const fingerMat = new MeshStandardMaterial({ color: '#c89b3c', metalness: 0.8, roughness: 0.35 });
    const fingerGeom = new PlaneGeometry(0.06, 0.018);
    for (const side of [-1, 1]) {
      const pads = L.pads.filter((p) => Math.sign(p.bond[1][0] - (dx0 + dx1) / 2) === side).sort((a, b) => a.bond[0][1] - b.bond[0][1]);
      pads.forEach((p, i) => {
        const [px, py] = toBoard(p.bond[0]);
        const fx = CHIP_X + side * 0.62;
        const fy = CHIP_Y + 0.6 - (1.2 * (i + 0.5)) / pads.length;
        const f = new Mesh(fingerGeom, fingerMat);
        f.position.set(fx + side * 0.03, fy, z + 0.003);
        fingers.add(f);
        // A gentle arc: up from the pad, over, and down onto the finger.
        const mx = (px + fx) / 2;
        const my = (py + fy) / 2;
        pts.push(px, py, z + 0.006, mx, my, z + 0.05, mx, my, z + 0.05, fx, fy, z + 0.004);
      });
    }
    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.inside.add(fingers, new LineSegments(geom, new LineBasicMaterial({ color: '#f2c75c' })));
    this.scene.add(this.inside);
  }

  /** Show or hide the LCD close-up beside the calculator (opt-in). */
  setLcdCutaway(on: boolean): void {
    this.lcdWanted = on;
    if (on && !this.lcd) {
      this.lcd = new LcdCutaway();
      this.lcd.group.position.set(LCD_X, LCD_Y, 0.4);
      this.scene.add(this.lcd.group);
      this.pickables.push(...this.lcd.pickables);
      // A thin line from the real segment (ones digit, top) to the close-up.
      const seg = this.segs.find((x) => x.pin === 'oa')!.mesh.position;
      const geom = new BufferGeometry();
      geom.setAttribute('position', new Float32BufferAttribute([seg.x, seg.y, seg.z + 0.01, LCD_X - 1.4, LCD_Y + 0.05, 0.4], 3));
      this.lcdLink = new LineSegments(geom, new LineBasicMaterial({ color: '#5fd7ff' }));
      this.scene.add(this.lcdLink);
    }
    if (this.instant) this.lcdShift = on ? 1 : 0;
  }

  get lcdCutaway(): boolean {
    return this.lcdWanted;
  }

  setSize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.setView(this.open);
  }

  /** Camera for a cover position (0 closed … 1 open), the dive and the LCD close-up. */
  private setView(open: number): void {
    const tanHalf = Math.tan((this.camera.fov * Math.PI) / 360);
    // Fit the calculator's height (about 11 units) whatever the aspect, and its width (wider
    // with the LCD close-up beside it).
    const shift = ease(this.lcdShift);
    const fitH = 11.5 / (2 * tanHalf);
    const fitW = (7.5 + 6 * shift) / (2 * tanHalf * this.camera.aspect);
    const dist = Math.max(fitH, fitW);
    const from = new Vector3(0.4 - 0.4 * open + LCD_SHIFT * shift, -2.6 + 1.6 * open, dist);
    const target = new Vector3(LCD_SHIFT * shift, -0.2 + 0.4 * open, 0);
    // The dive: over the package, the lid comes off, then down until the die fills the view.
    const d = this.dive;
    const chipPos = new Vector3(CHIP_X, CHIP_Y, BOARD_Z + 0.1);
    const dieH = DIE_W / this.dieAspect;
    const close = Math.max((DIE_W * 1.1) / (2 * tanHalf * this.camera.aspect), (dieH * 1.3) / (2 * tanHalf));
    const above = chipPos.clone().add(new Vector3(0, -0.35, 2.4));
    const onDie = chipPos.clone().add(new Vector3(0, 0, close));
    const a = part(d, 0, 0.35);
    const c = part(d, 0.6, 0.4);
    const cam = from.clone().lerp(above, a).lerp(onDie, c);
    const look = target.clone().lerp(chipPos, a);
    this.camera.position.copy(cam);
    this.camera.lookAt(look);
    // Lid: lifts and slides away, then fades.
    const l = part(d, 0.3, 0.35);
    this.lid.position.set(CHIP_X + 1.6 * l, CHIP_Y + 0.6 * l, BOARD_Z + 0.14 + 1.2 * l);
    this.lid.rotation.y = 0.9 * l;
    for (const m of this.lidMats) m.opacity = 1 - part(d, 0.5, 0.2);
    this.lid.visible = d < 0.7;
  }

  /** Start lifting the cover (or close it again). */
  setOpen(open: boolean): void {
    if (this.phase === 'diving') return;
    this.phase = open ? 'opening' : 'closing';
    if (this.instant) this.open = open ? 1 : 0;
  }

  /** Dive into the chip (opens the cover first if needed). */
  diveIn(): void {
    if (this.phase === 'closed' || this.phase === 'closing') this.setOpen(true);
    this.phase = 'diving';
    if (this.instant) {
      this.open = 1;
      this.dive = 1;
    }
  }

  /** Back to the closed calculator (when returning from the chip world). */
  reset(open = false): void {
    this.dive = 0;
    this.open = open ? 1 : 0;
    this.phase = open ? 'open' : 'closed';
    this.applyCover();
    this.setView(this.open);
  }

  /** A key was pressed (for the press animation). */
  press(code: number): void {
    this.pressedAt.set(code, this.time);
  }

  update(dtSec: number, segment: (pin: string) => boolean, mLamp: boolean): void {
    this.time += dtSec;
    const speed = dtSec / 1.1;
    if (this.phase === 'opening' || (this.phase === 'diving' && this.open < 1)) {
      this.open = Math.min(1, this.open + speed);
      if (this.open >= 1 && this.phase === 'opening') this.phase = 'open';
    } else if (this.phase === 'closing') {
      this.open = Math.max(0, this.open - speed);
      if (this.open <= 0) this.phase = 'closed';
    } else if (this.phase === 'diving') {
      this.dive = Math.min(1, this.dive + dtSec / DIVE_SEC);
      if (this.dive >= 1) {
        this.phase = 'open';
        this.onDived?.();
      }
    }
    const lcdTarget = this.lcdWanted ? 1 : 0;
    this.lcdShift = this.instant ? lcdTarget : this.lcdShift < lcdTarget ? Math.min(1, this.lcdShift + dtSec / 0.8) : Math.max(0, this.lcdShift - dtSec / 0.8);
    if (this.lcd) {
      const shown = this.lcdShift > 0.02 || this.lcdWanted;
      this.lcd.group.visible = shown;
      this.lcdLink!.visible = shown && this.lcdShift > 0.9;
      this.lcd.update(dtSec, segment('oa'));
    }
    this.applyCover();
    this.setView(this.open);
    for (const s of this.segs) s.mesh.material = segment(s.pin) ? this.segOn : this.segOff;
    this.mLamp.color = mLamp ? '#3df5ff' : '#22304a';
    for (const [code, k] of this.keys) {
      const t = this.time - (this.pressedAt.get(code) ?? -10);
      k.position.z = COVER_Z + 0.2 - (t < 0.15 ? 0.12 : 0);
    }
  }

  private applyCover(): void {
    const o = ease(this.open);
    this.cover.position.set(0, 11.5 * o, 2.5 * o);
    this.cover.rotation.x = -0.5 * o;
    this.cover.visible = o < 0.999;
  }

  /** What is under the pointer (canvas pixels). */
  pick(px: number, py: number, width: number, height: number): DeviceHit | null {
    this.raycaster.setFromCamera(new Vector2((px / width) * 2 - 1, -(py / height) * 2 + 1), this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o: Object3D | null = h.object;
      while (o && o.userData.key === undefined && o.userData.prop === undefined) o = o.parent;
      if (!o) continue;
      if (o.userData.key !== undefined) {
        if (!this.cover.visible) continue;
        return { kind: 'key', code: o.userData.key as number };
      }
      // Board parts are hidden by the cover while it is closed (except the display behind its
      // window, and the LCD close-up beside the calculator).
      if (o.userData.prop === 'lcd') {
        if (!this.lcd?.group.visible) continue;
        return { kind: 'prop', id: 'lcd' };
      }
      if (this.open < 0.5 && o.userData.prop !== 'display') return null;
      return { kind: 'prop', id: o.userData.prop as string };
    }
    return null;
  }

  render(renderer: WebGLRenderer): void {
    renderer.render(this.scene, this.camera);
  }
}

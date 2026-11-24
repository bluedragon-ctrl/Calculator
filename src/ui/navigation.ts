// Mouse navigation of the chip world: scroll = zoom toward the cursor, drag = pan (DESIGN.md §6.3).
import type { Stage, View } from '../render/stage';
import { flightDuration, flightView } from './flight';

const DRAG_THRESHOLD_PX = 4;

export class Navigator {
  private dragging: { x: number; y: number; cx: number; cy: number; moved: boolean } | null = null;
  private flight: { from: View; to: View; t: number; duration: number } | null = null;
  /** Called with world coordinates on a click that was not a drag. */
  onClick: ((x: number, y: number) => void) | null = null;
  /** Called with world coordinates (and canvas pixels) when the pointer moves. */
  onHover: ((x: number, y: number, px: number, py: number) => void) | null = null;
  /** Called with world coordinates on a double-click (fly to fit). */
  onDoubleClick: ((x: number, y: number) => void) | null = null;
  /** Called when the pointer leaves the canvas or starts dragging. */
  onLeave: (() => void) | null = null;
  /** When true, camera moves are instant (prefers-reduced-motion). */
  instant = false;

  constructor(private readonly stage: Stage) {
    const el = stage.renderer.domElement;
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', () => (this.dragging = null));
    el.addEventListener('pointerleave', () => this.onLeave?.());
    el.addEventListener('dblclick', (e) => {
      const [x, y] = this.local(e);
      this.onDoubleClick?.(...this.stage.toWorld(x, y));
    });
  }

  /** True while a camera flight is running. */
  get flying(): boolean {
    return this.flight !== null;
  }

  /** Smoothly move the camera to a view (duration defaults to one that suits the zoom change). */
  flyTo(to: View, duration = flightDuration(this.stage.view.height, to.height)): void {
    if (this.instant || duration <= 0) {
      this.flight = null;
      this.stage.setView(to);
      return;
    }
    this.flight = { from: { ...this.stage.view }, to, t: 0, duration };
  }

  update(dtSec: number): void {
    const f = this.flight;
    if (!f) return;
    f.t = Math.min(f.t + dtSec / f.duration, 1);
    this.stage.setView(flightView(f.from, f.to, f.t));
    if (f.t >= 1) this.flight = null;
  }

  private local(e: MouseEvent): [number, number] {
    const r = this.stage.renderer.domElement.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    this.flight = null;
    const [px, py] = this.local(e);
    const [wx, wy] = this.stage.toWorld(px, py);
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const factor = Math.exp(delta * 0.0015);
    const v = this.stage.view;
    this.stage.setView({ ...v, height: v.height * factor });
    // Keep the world point under the cursor fixed.
    const [nx, ny] = this.stage.toWorld(px, py);
    this.stage.setView({ ...this.stage.view, cx: this.stage.view.cx + (wx - nx), cy: this.stage.view.cy + (wy - ny) });
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    const [x, y] = this.local(e);
    this.dragging = { x, y, cx: this.stage.view.cx, cy: this.stage.view.cy, moved: false };
    this.stage.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    const d = this.dragging;
    if (!d) {
      this.onHover?.(...this.stage.toWorld(x, y), x, y);
      return;
    }
    if (!d.moved && Math.hypot(x - d.x, y - d.y) < DRAG_THRESHOLD_PX) return;
    if (!d.moved) this.onLeave?.();
    d.moved = true;
    this.flight = null;
    this.stage.renderer.domElement.style.cursor = 'grabbing';
    const k = 1 / this.stage.pxPerWorld;
    this.stage.setView({ ...this.stage.view, cx: d.cx - (x - d.x) * k, cy: d.cy + (y - d.y) * k });
  }

  private up(e: PointerEvent): void {
    const d = this.dragging;
    this.dragging = null;
    this.stage.renderer.domElement.style.cursor = '';
    if (d && !d.moved) {
      const [x, y] = this.local(e);
      this.onClick?.(...this.stage.toWorld(x, y));
    }
  }
}

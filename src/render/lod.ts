// Level-of-detail rules (DESIGN.md §6.3), kept free of three.js so they can be unit-tested.

/** On-screen width (CSS px) below which an expanded instance collapses back into a box. */
export const COLLAPSE_PX = 140;
/** On-screen width above which an instance opens to show its contents. */
export const EXPAND_PX = 220;
/** Cached contents of a collapsed instance are disposed once it is this small on screen… */
export const DISPOSE_PX = 50;
/** …or once it is this many view sizes away from the visible area. */
export const DISPOSE_DISTANCE = 1.5;
/** Duration of the box ↔ contents crossfade. */
export const FADE_SEC = 0.3;

export type Bounds = readonly [left: number, bottom: number, right: number, top: number];

export interface Rect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

/**
 * On-screen size used for the LOD rule: the larger side in CSS px. For gates (wider than tall)
 * this is the width of DESIGN.md §6.3; tall parts like the 8-bit adder open once they fill the
 * screen's height.
 */
export function screenSize(b: Bounds, pxPerWorld: number): number {
  return Math.max(b[2] - b[0], b[3] - b[1]) * pxPerWorld;
}

/** Should the instance show its contents? Hysteresis between COLLAPSE_PX and EXPAND_PX. */
export function wantExpanded(wasExpanded: boolean, px: number, canExpand: boolean): boolean {
  if (!canExpand) return false;
  return wasExpanded ? px >= COLLAPSE_PX : px > EXPAND_PX;
}

/** Move the crossfade alpha towards its target (0 = box, 1 = contents). `fadeSec` 0 = instant. */
export function stepAlpha(alpha: number, target: number, dtSec: number, fadeSec = FADE_SEC): number {
  if (fadeSec <= 0) return target;
  const step = dtSec / fadeSec;
  return target > alpha ? Math.min(target, alpha + step) : Math.max(target, alpha - step);
}

/** Smooth the linear fade so it eases in and out. */
export function ease(t: number): number {
  return t * t * (3 - 2 * t);
}

export function intersects(b: Bounds, r: Rect): boolean {
  return b[2] >= r.left && b[0] <= r.right && b[3] >= r.bottom && b[1] <= r.top;
}

/** Distance from bounds to the visible rect, in multiples of the view's larger side (0 if overlapping). */
export function distanceInViews(b: Bounds, r: Rect): number {
  const dx = Math.max(r.left - b[2], b[0] - r.right, 0);
  const dy = Math.max(r.bottom - b[3], b[1] - r.top, 0);
  const size = Math.max(r.right - r.left, r.top - r.bottom);
  return Math.hypot(dx, dy) / size;
}

/** Cached contents can be thrown away when the instance is collapsed and small or far away. */
export function shouldDispose(alpha: number, px: number, b: Bounds, r: Rect): boolean {
  return alpha === 0 && (px < DISPOSE_PX || distanceInViews(b, r) > DISPOSE_DISTANCE);
}

/** Camera view that fits bounds with a margin, for a canvas of the given aspect (width / height). */
export function fitView(b: Bounds, aspect: number, margin = 1.2): { cx: number; cy: number; height: number } {
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  return { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, height: Math.max(h, w / aspect) * margin };
}

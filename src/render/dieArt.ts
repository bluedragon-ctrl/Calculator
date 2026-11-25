// Static layout art for the "real chip" views (DESIGN.md §6.2a, Phase 4c), baked into textures:
//   - cell miniatures: the generated silicon cell of a primitive gate (the same layout the
//     transistor-level silicon view draws and the layout-versus-schematic test checks);
//   - die blocks: rows of those same cells, or the stored-bit grid of a ROM/PLA;
//   - the die itself: silicon, pad ring and bond pads.
// One texture per cell type and one per block, so the die costs a handful of draw calls.
// Colours stay at or below 1.0: the art never blooms.
import { DataTexture, LinearFilter, LinearMipmapLinearFilter, RGBAFormat, SRGBColorSpace, type Color } from 'three';
import { blockPlan, type BlockPlan, type DieArray, type DieLayout, type DieRegion } from '../circuits/dieLayout';
import { siliconLayout, type Rect, type SiliconLayout } from '../circuits/siliconLayout';
import type { Library } from '../sim/library';
import type { ComponentDef } from '../sim/types';
import {
  CONTACT_COLOR, DIE_BLOCK, DIE_PAD, DIE_RING, DIE_SILICON, DIFF_COLOR, METAL_COLOR, POLY_COLOR, WELL_COLOR,
} from './palette';
import { Raster, type RGB } from './raster';

/** sRGB components of a palette colour, scaled by `k` (the art is drawn a little dimmer than live silicon). */
export function srgb(c: Color, k = 1): RGB {
  const s = c.clone().convertLinearToSRGB();
  return [s.r * k, s.g * k, s.b * k];
}

/** Brightness of static art compared with the live silicon view (it shows layers, not values). */
export const ART_DIM = 0.78;

/** Layer colours of the art, drawn in this order (bottom to top). */
export const ART_COLORS = {
  well: srgb(WELL_COLOR, 1.2),
  pdiff: srgb(DIFF_COLOR, ART_DIM),
  ndiff: srgb(DIFF_COLOR, ART_DIM),
  poly: srgb(POLY_COLOR, ART_DIM),
  metal: srgb(METAL_COLOR, ART_DIM),
  contact: srgb(CONTACT_COLOR, ART_DIM),
} as const;
const LAYER_ORDER = ['pdiff', 'ndiff', 'poly', 'metal', 'contact'] as const;
const METAL_ALPHA = 0.8;

/** Paint a silicon cell layout into `rect` (raster units), keeping its own proportions. */
export function paintCell(r: Raster, layout: SiliconLayout, rect: Rect): void {
  const kx = (rect[2] - rect[0]) / layout.width;
  const ky = (rect[3] - rect[1]) / layout.height;
  const map = (s: Rect): Rect => [rect[0] + s[0] * kx, rect[1] + s[1] * ky, rect[0] + s[2] * kx, rect[1] + s[3] * ky];
  for (const w of layout.wells) r.fill(map(w), ART_COLORS.well, 0.9);
  for (const layer of LAYER_ORDER) {
    for (const s of layout.shapes) {
      if (s.layer === layer) r.fill(map(s.rect), ART_COLORS[layer], layer === 'metal' ? METAL_ALPHA : 1);
    }
  }
}

/** A ROM/PLA as a grid: poly word lines across, metal bit lines down, a transistor at each stored 1. */
export function paintArray(r: Raster, a: DieArray): void {
  const [x0, y0, x1, y1] = a.rect;
  const rows = a.bits.length;
  const cols = a.bits[0].length;
  const pw = (x1 - x0) / cols;
  const ph = (y1 - y0) / rows;
  for (let i = 0; i < rows; i++) {
    const cy = y0 + (i + 0.5) * ph;
    r.fill([x0, cy - ph * 0.12, x1, cy + ph * 0.12], ART_COLORS.poly);
  }
  for (let j = 0; j < cols; j++) {
    const cx = x0 + (j + 0.5) * pw;
    r.fill([cx - pw * 0.14, y0, cx + pw * 0.14, y1], ART_COLORS.metal, METAL_ALPHA);
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      if (!a.bits[i][j]) continue;
      const cx = x0 + (j + 0.5) * pw;
      const cy = y0 + (i + 0.5) * ph;
      r.fill([cx - pw * 0.34, cy - ph * 0.34, cx + pw * 0.34, cy + ph * 0.34], ART_COLORS.ndiff);
      r.fill([cx - pw * 0.12, cy - ph * 0.12, cx + pw * 0.12, cy + ph * 0.12], ART_COLORS.contact);
    }
  }
}

const layouts = new Map<string, SiliconLayout>();
/** The silicon layout of a primitive, shared by every user (computed once per type). */
export function cellLayout(def: ComponentDef): SiliconLayout {
  let l = layouts.get(def.name);
  if (!l) {
    l = siliconLayout(def);
    layouts.set(def.name, l);
  }
  return l;
}

/** Paint one block: its background, then its arrays and cells. */
export function paintRegion(r: Raster, region: DieRegion, lib: Library): void {
  r.fill(region.rect, srgb(DIE_BLOCK));
  for (const a of region.arrays) paintArray(r, a);
  for (const c of region.cells) paintCell(r, cellLayout(lib.get(c.type)), c.rect);
}

/** Paint the die: silicon, the pad ring and the bond pads (and, if asked, every block). */
export function paintDie(r: Raster, layout: DieLayout, lib: Library, withBlocks: boolean): void {
  r.fill(layout.die, srgb(DIE_RING));
  r.fill(layout.core, srgb(DIE_SILICON));
  for (const p of layout.pads) {
    r.fill(p.rect, srgb(DIE_PAD));
    const [x0, y0, x1, y1] = p.rect;
    const m = (x1 - x0) * 0.22;
    r.fill([x0 + m, y0 + m, x1 - m, y1 - m], srgb(DIE_PAD, 0.8));
  }
  if (withBlocks) for (const reg of layout.regions) paintRegion(r, reg, lib);
}

/** Pixel size for a rect at `pxPerUnit`, capped so no texture gets huge. */
export function rasterSize(rect: Rect, pxPerUnit: number, max = 2048): [number, number] {
  const w = rect[2] - rect[0];
  const h = rect[3] - rect[1];
  const k = Math.min(pxPerUnit, max / Math.max(w, h));
  return [Math.max(1, Math.ceil(w * k)), Math.max(1, Math.ceil(h * k))];
}

export function toTexture(r: Raster): DataTexture {
  const t = new DataTexture(r.data, r.width, r.height, RGBAFormat);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Longest side of a miniature texture (pixels). */
const MINI_MAX = 384;
export interface Miniature {
  raster: Raster;
  texture: DataTexture;
  /** A primitive's own cell layout (filling the box exactly), or the plan of a composite. */
  layout: SiliconLayout | null;
  plan: BlockPlan | null;
}
const miniCache = new Map<string, Miniature | null>();

/**
 * The miniature shown on a closed box in "Real chip" mode, baked once per component type and
 * shared by every box of that type (never disposed: there are only a few dozen types).
 *   - A primitive gate: its silicon cell, exactly as the transistor-level view draws it (the
 *     cell's frame is the gate's inner frame, so it fills the box).
 *   - A composite: its gates as the same cells in rows, its ROM/PLA as bit grids (no wiring),
 *     like its block on the die.
 * Null when there is nothing to draw (the constant 0 is just a wire).
 */
export function miniature(def: ComponentDef, lib: Library): Miniature | null {
  if (miniCache.has(def.name)) return miniCache.get(def.name)!;
  let m: Miniature | null = null;
  if (def.cmos) {
    const layout = cellLayout(def);
    const rect: Rect = [0, 0, layout.width, layout.height];
    const [w, h] = rasterSize(rect, Infinity, MINI_MAX);
    const raster = new Raster(w, h, rect);
    raster.fill(rect, srgb(DIE_BLOCK));
    paintCell(raster, layout, rect);
    m = { raster, texture: toTexture(raster), layout, plan: null };
  } else if (def.parts || def.table) {
    const rect: Rect = [0, 0, def.size[0], def.size[1]];
    const plan = blockPlan(def, lib, rect);
    if (plan.cells.length || plan.arrays.length) {
      const [w, h] = rasterSize(rect, Infinity, MINI_MAX * 1.5);
      const raster = new Raster(w, h, rect);
      raster.fill(rect, srgb(DIE_BLOCK));
      for (const a of plan.arrays) paintArray(raster, a);
      for (const c of plan.cells) paintCell(raster, cellLayout(lib.get(c.type)), c.rect);
      m = { raster, texture: toTexture(raster), layout: null, plan };
    }
  }
  miniCache.set(def.name, m);
  return m;
}

// A tiny software rasterizer for baking static layout art into textures (DESIGN.md §6.2a, Phase
// 4c): the die's block patterns and the cell miniatures. Only axis-aligned rectangles, with
// anti-aliased edges. Pure TypeScript (no three.js, no DOM), so the art can be tested headless.
//
// Coordinates are layout units with y pointing down; `bounds` maps them onto the pixel grid.
// Rows are stored bottom row first, as WebGL textures expect.
import type { Rect } from '../circuits/siliconLayout';

export type RGB = readonly [number, number, number];

export class Raster {
  readonly data: Uint8Array;
  private readonly sx: number;
  private readonly sy: number;

  constructor(readonly width: number, readonly height: number, readonly bounds: Rect) {
    this.data = new Uint8Array(width * height * 4);
    this.sx = width / (bounds[2] - bounds[0]);
    this.sy = height / (bounds[3] - bounds[1]);
  }

  /** Fill a rectangle (layout units) with a colour (0…1 per channel), blended `alpha` over what is there. */
  fill(rect: Rect, rgb: RGB, alpha = 1): void {
    const px0 = (rect[0] - this.bounds[0]) * this.sx;
    const px1 = (rect[2] - this.bounds[0]) * this.sx;
    const py0 = (rect[1] - this.bounds[1]) * this.sy;
    const py1 = (rect[3] - this.bounds[1]) * this.sy;
    const ix0 = Math.max(0, Math.floor(px0));
    const ix1 = Math.min(this.width, Math.ceil(px1));
    const iy0 = Math.max(0, Math.floor(py0));
    const iy1 = Math.min(this.height, Math.ceil(py1));
    if (ix0 >= ix1 || iy0 >= iy1) return;
    const r = rgb[0] * 255;
    const g = rgb[1] * 255;
    const b = rgb[2] * 255;
    for (let y = iy0; y < iy1; y++) {
      // Coverage of this pixel row (anti-aliased top and bottom edges).
      const cy = Math.min(y + 1, py1) - Math.max(y, py0);
      if (cy <= 0) continue;
      let i = ((this.height - 1 - y) * this.width + ix0) * 4;
      for (let x = ix0; x < ix1; x++, i += 4) {
        const cx = Math.min(x + 1, px1) - Math.max(x, px0);
        const a = alpha * cx * cy;
        if (a <= 0) continue;
        const d = this.data;
        d[i] += (r - d[i]) * a;
        d[i + 1] += (g - d[i + 1]) * a;
        d[i + 2] += (b - d[i + 2]) * a;
        d[i + 3] += (255 - d[i + 3]) * a;
      }
    }
  }

  /** The pixel at a layout point, as 0…255 RGBA (for tests). */
  pixel(x: number, y: number): [number, number, number, number] {
    const px = Math.min(this.width - 1, Math.max(0, Math.floor((x - this.bounds[0]) * this.sx)));
    const py = Math.min(this.height - 1, Math.max(0, Math.floor((y - this.bounds[1]) * this.sy)));
    const i = ((this.height - 1 - py) * this.width + px) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
}

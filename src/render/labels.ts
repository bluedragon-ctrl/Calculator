// In-scene text (troika-three-text) with a bundled font: no runtime CDN (CLAUDE.md).
// Labels stay at or below 1.0 brightness, so bloom never touches them.
import { Text } from 'troika-three-text';
import type { Color } from 'three';
import fontUrl from '../assets/fonts/inter-latin-600-normal.woff?url';
import { LABEL } from './palette';

export interface LabelOptions {
  size: number;
  color?: Color;
  anchorX?: 'left' | 'center' | 'right';
  anchorY?: 'top' | 'middle' | 'bottom';
  /** Hide when smaller than this many CSS pixels on screen. */
  minPx?: number;
}

export class Label {
  readonly text: Text;
  private readonly minPx: number;

  constructor(content: string, x: number, y: number, opts: LabelOptions) {
    const t = new Text();
    t.text = content;
    t.font = fontUrl;
    t.fontSize = opts.size;
    t.color = opts.color ?? LABEL;
    t.anchorX = opts.anchorX ?? 'center';
    t.anchorY = opts.anchorY ?? 'middle';
    t.position.set(x, y, 0.2);
    t.sync();
    this.text = t;
    this.minPx = opts.minPx ?? 7;
  }

  set content(s: string) {
    if (this.text.text !== s) {
      this.text.text = s;
      this.text.sync();
    }
  }

  /** Show only when readable: `pxPerUnit` is screen pixels per local unit. `alpha` fades it. */
  fit(pxPerUnit: number, alpha = 1): void {
    const px = this.text.fontSize * pxPerUnit;
    this.text.visible = px >= this.minPx && px <= 300 && alpha > 0.01;
    if (this.text.fillOpacity !== alpha) this.text.fillOpacity = alpha;
  }

  dispose(): void {
    this.text.dispose();
  }
}

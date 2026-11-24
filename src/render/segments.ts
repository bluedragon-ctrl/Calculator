// Geometry of a 7-segment digit (pure, shared by the chip-world display, the HUD and the
// device). Coordinates: origin at the digit's top-left, y down, digit w × h.

export type SegmentName = 'a' | 'b' | 'c' | 'd' | 'e' | 'f' | 'g';
export const SEGMENTS: SegmentName[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

/** Centre x, centre y, width, height of each segment's rectangle. */
export function segmentRects(w: number, h: number): Record<SegmentName, [number, number, number, number]> {
  const t = w * 0.16; // stroke thickness
  const hl = w - t * 1.4; // horizontal segment length
  const vl = (h - t * 3) / 2 + t * 0.3; // vertical segment length
  const cx = w / 2;
  const top = t / 2;
  const mid = h / 2;
  const bot = h - t / 2;
  const left = t / 2;
  const right = w - t / 2;
  return {
    a: [cx, top, hl, t],
    g: [cx, mid, hl, t],
    d: [cx, bot, hl, t],
    f: [left, (top + mid) / 2, t, vl],
    b: [right, (top + mid) / 2, t, vl],
    e: [left, (mid + bot) / 2, t, vl],
    c: [right, (mid + bot) / 2, t, vl],
  };
}

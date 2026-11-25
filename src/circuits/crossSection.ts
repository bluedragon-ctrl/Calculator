// Side view (cross-section) of one transistor for the single-transistor bench (DESIGN.md §6.2a,
// Phase 4b). Pure geometry, y down, the silicon surface at y = SURFACE.
//
//   metal ─┐        ┌─ metal ─┐        ┌─ metal
//          │     [ poly gate ]         │
//          │     [  oxide   ]          │
//   ═══[ source ]~~channel~~[ drain ]═══  ← surface
//        substrate (p-type), or an n-well for a P-type transistor
import type { Rect } from './siliconLayout';

export type CrossPart =
  | 'substrate' | 'well' | 'sourceDrain' | 'channel' | 'oxide' | 'poly' | 'contact' | 'metal';

export interface CrossShape {
  part: CrossPart;
  rect: Rect;
  /** Which terminal a conductor belongs to: the gate, the power side or the lamp side. */
  terminal?: 'gate' | 'power' | 'lamp';
}

export interface CrossSection {
  width: number;
  height: number;
  type: 'n' | 'p';
  shapes: CrossShape[];
  /** Labels above the three terminals. */
  labels: { key: CrossLabel; at: [number, number] }[];
  /** Labels right of the drawing, each with a leader line to the part it names. */
  callouts: { key: CrossLabel; at: [number, number]; target: [number, number] }[];
}

export type CrossLabel = 'gate' | 'oxide' | 'power' | 'lamp' | 'channel' | 'substrate' | 'well' | 'regions';

export const SURFACE = 4.6;
/** Room right of the drawing for the callouts. */
export const CALLOUT_ROOM = 8.5;

export function crossSection(type: 'n' | 'p'): CrossSection {
  const W = 20;
  const H = 9;
  const S = SURFACE;
  const shapes: CrossShape[] = [{ part: 'substrate', rect: [0, S, W, H] }];
  if (type === 'p') shapes.push({ part: 'well', rect: [1, S, W - 1, H - 1.4] });
  // Source/drain islands either side of the gate, and the channel between them at the surface.
  const sd: [Rect, 'power' | 'lamp'][] = [[[2, S, 6, S + 1.3], 'power'], [[14, S, 18, S + 1.3], 'lamp']];
  for (const [rect, terminal] of sd) {
    shapes.push({ part: 'sourceDrain', rect, terminal });
    const cx = (rect[0] + rect[2]) / 2;
    shapes.push({ part: 'contact', rect: [cx - 0.35, 1.6, cx + 0.35, S], terminal });
    shapes.push({ part: 'metal', rect: [cx - 1.3, 0.9, cx + 1.3, 1.6], terminal });
  }
  shapes.push({ part: 'channel', rect: [6, S, 14, S + 0.4] });
  shapes.push({ part: 'oxide', rect: [6, S - 0.3, 14, S] });
  shapes.push({ part: 'poly', rect: [6, S - 1.9, 14, S - 0.3], terminal: 'gate' });
  shapes.push({ part: 'contact', rect: [9.65, 1.6, 10.35, S - 1.9], terminal: 'gate' });
  shapes.push({ part: 'metal', rect: [8.7, 0.9, 11.3, 1.6], terminal: 'gate' });
  const callouts: CrossSection['callouts'] = [
    { key: 'oxide', at: [W + 0.8, S - 1.2], target: [13.6, S - 0.15] },
    { key: 'channel', at: [W + 0.8, S + 0.0], target: [13.2, S + 0.2] },
    { key: 'regions', at: [W + 0.8, S + 1.2], target: [17.4, S + 0.9] },
  ];
  if (type === 'p') callouts.push({ key: 'well', at: [W + 0.8, S + 2.4], target: [18.6, S + 2.4] });
  callouts.push({ key: 'substrate', at: [W + 0.8, H - 0.7], target: [W - 0.4, H - 0.7] });
  return {
    width: W, height: H, type, shapes, callouts,
    labels: [
      { key: 'power', at: [4, 0.4] },
      { key: 'gate', at: [10, 0.4] },
      { key: 'lamp', at: [16, 0.4] },
    ],
  };
}

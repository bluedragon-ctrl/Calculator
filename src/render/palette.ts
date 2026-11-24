// Visual language constants (DESIGN.md §6.4).
import { Color } from 'three';

export const BACKGROUND = new Color('#070b14');
export const GRID = new Color('#0e1628');
export const WIRE_OFF = new Color('#2a3550');
export const WIRE_ON = new Color('#3df5ff');

/**
 * Bloom is selective by brightness: only colours pushed above 1.0 bloom.
 * "1" wires (and later sparks, active transistors) use this boost; labels never do.
 */
export const BLOOM_BOOST = 1.8;
export const BLOOM_THRESHOLD = 1.0;

/** Line widths in CSS pixels. On/off differs in width too, not only colour. */
export const WIRE_WIDTH_OFF = 2;
export const WIRE_WIDTH_ON = 4.5;
/** Low quality: fake glow with a wider additive line. */
export const GLOW_WIDTH = 14;
export const GLOW_OPACITY = 0.22;

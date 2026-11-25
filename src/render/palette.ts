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

/** Power rails (DESIGN.md §6.4): warm amber VDD, dim grey GND. Never bloomed. */
export const VDD_COLOR = new Color('#ffb347');
export const GND_COLOR = new Color('#5d6880');
/** Component outlines, frames and labels: readable, never above 1.0. */
export const OUTLINE = new Color('#7f93c4');
export const FRAME = new Color('#26324e');
export const LABEL = new Color('#c9d6f2');
export const LABEL_DIM = new Color('#7f8fb3');
/** Transistor channel when on (bloomed on high quality). */
export const CHANNEL_ON = new Color('#7dffb2');
/** Conducting-path highlight: towards VDD (output 1) or towards GND (output 0). */
export const PATH_VDD = new Color('#ffb347');
export const PATH_GND = new Color('#a58bff');
export const OUTLINE_WIDTH = 1.6;
export const PATH_WIDTH = 12;
/** Spark diameter in CSS pixels. */
export const SPARK_PX = 11;
/** Load capacitor (§6.2a): a faint symbol, and the charge in its gauge (not bloomed). */
export const CAP_COLOR = new Color('#4d5d85');
export const CHARGE = new Color('#3df5ff');
/**
 * Silicon view (§6.2a, Phase 4b): the usual layout-plot colours, kept at or below 1.0 so the
 * fills never bloom. A piece carrying 1 is drawn at full brightness with a bright outline; a
 * piece at 0 is dimmed with a thin outline (brightness and thickness, not colour alone).
 */
export const DIFF_COLOR = new Color('#2fa35f');
export const POLY_COLOR = new Color('#d9473c');
export const METAL_COLOR = new Color('#3f78e0');
export const CONTACT_COLOR = new Color('#b8c1d1');
export const WELL_COLOR = new Color('#1a3125');
/** Brightness of a fill whose piece is at 0. */
export const UNLIT = 0.42;

// Generates the display ROM (DESIGN.md §4.2): for every 8-bit value of X, the sign and three
// digit codes (hundreds, tens, ones) to show. Never hand-written: computed here, checked by tests
// against JavaScript's own number formatting.
import type { Bit } from '../../sim/types';

/** Digit codes understood by the 7-segment decoders. */
export const CODE_E = 10;
export const CODE_R = 11;
export const CODE_BLANK = 12;

export interface DisplayRow {
  /** 1 = show the minus sign. */
  sign: Bit;
  hundreds: number;
  tens: number;
  ones: number;
}

/** Row for the 8-bit pattern `address` (0…255), read as two's complement. */
export function displayRow(address: number): DisplayRow {
  const v = address >= 128 ? address - 256 : address;
  const a = Math.abs(v);
  return {
    sign: v < 0 ? 1 : 0,
    // Leading zeros are blank; the ones digit always shows.
    hundreds: a >= 100 ? Math.floor(a / 100) : CODE_BLANK,
    tens: a >= 10 ? Math.floor(a / 10) % 10 : CODE_BLANK,
    ones: a % 10,
  };
}

export const DISPLAY_ROM: readonly DisplayRow[] = Array.from({ length: 256 }, (_, i) => displayRow(i));

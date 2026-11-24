// Formatting values for students (DESIGN.md §7.1: decimal is always shown next to binary).
import { binaryString } from '../sim/bus';
import type { Bit } from '../sim/types';

/** "1 (on)" / "0 (off)": never only a colour. */
export function formatBit(v: Bit): string {
  return v ? '1 (on)' : '0 (off)';
}

/** Decimal and binary, with a real minus sign: "−3 (binary 11111101)". */
export function formatBus(name: string, value: number, bits: readonly Bit[]): string {
  return `${name} = ${formatNumber(value)} (binary ${binaryString(bits)})`;
}

export function formatNumber(v: number): string {
  return v < 0 ? `−${-v}` : String(v);
}

/** Parse what a student typed (accepts "-5", "−5", " 12 "); null when it is not a whole number. */
export function parseNumber(s: string): number | null {
  const t = s.trim().replace('−', '-');
  if (!/^-?\d+$/.test(t)) return null;
  return Number(t);
}

/** Clamp to the signed range of `width` bits. */
export function clampSigned(v: number, width = 8): number {
  const max = 2 ** (width - 1);
  return Math.min(max - 1, Math.max(-max, v));
}

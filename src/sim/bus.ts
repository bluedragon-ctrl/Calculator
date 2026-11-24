// Reading and writing groups of bits as numbers (DESIGN.md §5.4). Pure: no rendering.
import type { Bit, BusDef } from './types';

/** Bits (least significant first) → number. Signed buses use two's complement. */
export function bitsToNumber(bits: readonly Bit[], signed = true): number {
  let v = 0;
  for (let i = 0; i < bits.length; i++) v |= bits[i] << i;
  if (signed && bits.length > 0 && bits[bits.length - 1] === 1) v -= 2 ** bits.length;
  return v;
}

/** Number → bits (least significant first), wrapping to `width` bits. */
export function numberToBits(v: number, width: number): Bit[] {
  const u = ((Math.trunc(v) % 2 ** width) + 2 ** width) % 2 ** width;
  return Array.from({ length: width }, (_, i) => ((u >> i) & 1) as Bit);
}

/** Binary string, most significant bit first. */
export function binaryString(bits: readonly Bit[]): string {
  return [...bits].reverse().join('');
}

export function busValue(bus: BusDef, read: (pin: string) => Bit): { value: number; bits: Bit[] } {
  const bits = bus.pins.map(read);
  return { value: bitsToNumber(bits, bus.signed ?? true), bits };
}

import { describe, expect, it } from 'vitest';
import { binaryString, bitsToNumber, numberToBits } from '../src/sim/bus';

describe('bus helpers', () => {
  it('round-trips every 8-bit value, signed and unsigned', () => {
    for (let v = -128; v < 128; v++) expect(bitsToNumber(numberToBits(v, 8))).toBe(v);
    for (let v = 0; v < 256; v++) expect(bitsToNumber(numberToBits(v, 8), false)).toBe(v);
  });
  it('writes binary most significant bit first', () => {
    expect(binaryString(numberToBits(5, 8))).toBe('00000101');
    expect(binaryString(numberToBits(-2, 8))).toBe('11111110');
  });
});

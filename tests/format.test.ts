import { describe, expect, it } from 'vitest';
import { clampSigned, formatBit, formatBus, parseNumber } from '../src/ui/format';
import { numberToBits } from '../src/sim/bus';

describe('formatting for students', () => {
  it('shows decimal next to binary', () => {
    expect(formatBus('A', 7, numberToBits(7, 8))).toBe('A = 7 (binary 00000111)');
    expect(formatBus('R', -2, numberToBits(-2, 8))).toBe('R = −2 (binary 11111110)');
  });
  it('names on/off in words, not only colour', () => {
    expect(formatBit(1)).toBe('1 (on)');
    expect(formatBit(0)).toBe('0 (off)');
  });
  it('parses typed numbers', () => {
    expect(parseNumber(' 12 ')).toBe(12);
    expect(parseNumber('−5')).toBe(-5);
    expect(parseNumber('-5')).toBe(-5);
    expect(parseNumber('1.5')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(clampSigned(300)).toBe(127);
    expect(clampSigned(-300)).toBe(-128);
  });
});

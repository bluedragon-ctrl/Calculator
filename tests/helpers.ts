import type { Bit } from '../src/sim/types';

/** All 2^n input combinations as bit arrays (first input is the most significant). */
export function allInputs(n: number): Bit[][] {
  const rows: Bit[][] = [];
  for (let i = 0; i < 1 << n; i++) {
    rows.push(Array.from({ length: n }, (_, k) => ((i >> (n - 1 - k)) & 1) as Bit));
  }
  return rows;
}

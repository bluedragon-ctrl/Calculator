// Two-level logic minimisation (Quine–McCluskey with a greedy cover) for small truth tables.
// Used to generate gate-level decoders from their truth tables (e.g. the 7-segment decoder),
// so the gates are never hand-derived. Pure: no rendering.

/** A product term over n variables: `mask` bits are the variables used, `value` their required values. */
export interface Term {
  mask: number;
  value: number;
}

const popcount = (x: number) => {
  let n = 0;
  for (; x; x &= x - 1) n++;
  return n;
}

export function termCovers(t: Term, row: number): boolean {
  return (row & t.mask) === t.value;
}

/** Prime implicants of the on-set `ones` (rows 0 … 2^n − 1), with optional don't-cares. */
export function primeImplicants(n: number, ones: number[], dontCare: number[] = []): Term[] {
  const full = (1 << n) - 1;
  let current = new Map<string, Term>();
  for (const r of [...ones, ...dontCare]) current.set(`${full}:${r}`, { mask: full, value: r });
  const primes: Term[] = [];
  while (current.size) {
    const next = new Map<string, Term>();
    const used = new Set<string>();
    const list = [...current.entries()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const [ka, a] = list[i];
        const [kb, b] = list[j];
        if (a.mask !== b.mask) continue;
        const diff = a.value ^ b.value;
        if (popcount(diff) !== 1) continue;
        const t = { mask: a.mask & ~diff, value: a.value & ~diff };
        next.set(`${t.mask}:${t.value}`, t);
        used.add(ka).add(kb);
      }
    }
    for (const [k, t] of current) if (!used.has(k)) primes.push(t);
    current = next;
  }
  return primes;
}

/** A small cover of `ones` by prime implicants: essential primes first, then greedy. */
export function minimise(n: number, ones: number[], dontCare: number[] = []): Term[] {
  if (ones.length === 0) return [];
  const primes = primeImplicants(n, ones, dontCare);
  const left = new Set(ones);
  const chosen: Term[] = [];
  const take = (t: Term) => {
    chosen.push(t);
    for (const r of [...left]) if (termCovers(t, r)) left.delete(r);
  };
  for (const r of ones) {
    const cov = primes.filter((p) => termCovers(p, r));
    if (cov.length === 1 && !chosen.includes(cov[0])) take(cov[0]);
  }
  while (left.size) {
    let best = primes[0];
    let bestScore = -1;
    for (const p of primes) {
      const c = [...left].filter((r) => termCovers(p, r)).length;
      // More rows covered first; fewer literals breaks ties.
      const score = c * 16 - popcount(p.mask);
      if (c > 0 && score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    take(best);
  }
  return chosen;
}

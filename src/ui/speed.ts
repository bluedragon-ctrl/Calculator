// The one speed slider (DESIGN.md §6.5): 0 = slowest, SPEED_MAX = instant (no animation).
// It sets both the slow motion (ms per delta step) and the clock rate while running.
export const SPEED_MAX = 100;
export const SLOWMO_MIN_MS = 20;
export const SLOWMO_MAX_MS = 1000;
export const RATE_MIN = 0.5;
export const RATE_MAX = 4;
/** Default position: about 200 ms per step. */
export const DEFAULT_SPEED = 40;
/** Position used when the calculator is first shown: about 30 ms per step (a tick is ~40 steps). */
export const CALCULATOR_SPEED = 90;

const frac = (v: number) => Math.min(Math.max(v, 0), SPEED_MAX - 1) / (SPEED_MAX - 1);

export function isInstant(v: number): boolean {
  return v >= SPEED_MAX;
}

/** Milliseconds per delta step; 0 = instant. Decreases from 1000 to 20 as the slider moves right. */
export function speedToMs(v: number): number {
  if (isInstant(v)) return 0;
  return Math.round(SLOWMO_MAX_MS * (SLOWMO_MIN_MS / SLOWMO_MAX_MS) ** frac(v));
}

/**
 * Clock ticks per second while running. The clock also waits for each tick's animation,
 * so at slow speeds the animation sets the pace and this is only the shortest gap.
 */
export function speedToRate(v: number): number {
  if (isInstant(v)) return RATE_MAX;
  return Math.round(RATE_MIN * (RATE_MAX / RATE_MIN) ** frac(v) * 100) / 100;
}

export function speedLabel(v: number): string {
  const ms = speedToMs(v);
  return ms === 0 ? 'instant' : `${ms} ms / step`;
}

// Slow-motion slider mapping (DESIGN.md §6.5): 0 = instant, otherwise 20–1000 ms per delta step.
export const SLOWMO_MIN_MS = 20;
export const SLOWMO_MAX_MS = 1000;

export function sliderToMs(v: number): number {
  if (v <= 0) return 0;
  const t = (Math.min(v, 100) - 1) / 99;
  return Math.round(SLOWMO_MIN_MS * (SLOWMO_MAX_MS / SLOWMO_MIN_MS) ** t);
}

export function msLabel(ms: number): string {
  return ms === 0 ? 'instant' : `${ms} ms / step`;
}

// Camera flight between two views (DESIGN.md §6.3 fly-to). Zoom is interpolated in log space so
// it feels even across scales. The centre moves in step with the zoom: while zooming in, most of
// the pan happens early (still zoomed out); while zooming out, it happens late. So the target
// stays on screen the whole way instead of drifting off during a deep zoom.
export interface FlightView {
  cx: number;
  cy: number;
  height: number;
}

/** Smooth start and stop. */
export function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2;
}

export function flightView(from: FlightView, to: FlightView, t: number): FlightView {
  const e = easeInOut(Math.min(Math.max(t, 0), 1));
  const h = Math.exp(Math.log(from.height) + (Math.log(to.height) - Math.log(from.height)) * e);
  // Fraction of the pan done: how much of the zoom change has happened (linear if barely zooming).
  const dh = to.height - from.height;
  const zooming = Math.abs(Math.log(to.height / from.height)) > 0.25;
  const p = zooming ? (h - from.height) / dh : e;
  return { cx: from.cx + (to.cx - from.cx) * p, cy: from.cy + (to.cy - from.cy) * p, height: h };
}

/** Longer flights for bigger zoom changes: 0.6 s plus a little per doubling, at most 2 s. */
export function flightDuration(fromHeight: number, toHeight: number): number {
  return Math.min(2, 0.6 + 0.12 * Math.abs(Math.log2(toHeight / fromHeight)));
}

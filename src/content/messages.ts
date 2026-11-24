// Student-facing text. Plain English, ages 12+.

export const noWebGL = {
  title: 'Your browser can’t show this page',
  body:
    'This page needs WebGL 2 to draw the glowing circuits. ' +
    'Try the latest Chrome, Edge or Firefox, or ask an adult to turn on graphics acceleration.',
};

/** Clock bar (DESIGN.md §2, §6.5). */
export const clockText = {
  group: 'Clock',
  pause: '⏸ Pause',
  pauseTitle: 'Stop the clock. Use Step to make one tick at a time.',
  step: '⏭ Step',
  stepTitle: 'One clock tick (Space).',
  play: '▶ Play',
  playTitle: 'Run the clock: it ticks again once the last tick has finished.',
  instant: '⚡ Instant',
  instantTitle: 'No animation: every tick shows its result at once.',
  speedTitle: 'Clock speed while playing',
  pulseTitle: 'The clock: it lights up on every tick.',
  ticks: (n: number) => `tick ${n}`,
  noClock: 'This part has no clock. Try the flip-flop or the register.',
};

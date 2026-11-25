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
  run: '▶ Run',
  runTitle: 'Run the clock. The calculator stops by itself when it is waiting for a key.',
  speed: 'Speed',
  speedTitle: 'How fast time runs. Far left: very slow motion. Far right: instant, no animation.',
  pulseTitle: 'The clock: it lights up on every tick.',
  ticks: (n: number) => `tick ${n}`,
  noClock: 'This part has no clock. Try the flip-flop, the register or the calculator.',
};

/** Explore menu and view controls (DESIGN.md §2). */
export const exploreText = {
  label: 'Explore',
  title: 'Choose what to look at: the calculator, or one part of it on the lab bench.',
  calculatorGroup: 'Calculator',
  fitView: '⤢ Fit view',
  fitViewTitle: 'Zoom out to see the whole thing (Home key). Backspace zooms out one level.',
};

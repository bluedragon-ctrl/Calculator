// Student-facing text for the whole calculator (DESIGN.md §7.1: plain English for ages 12+,
// ≤ 40 words per panel step).

export const calculatorPanel = {
  /** Name in the Explore menu. */
  button: 'Inside the chip',
  steps: [
    'Type 7 + 9 = on your keyboard, or click the keys. Watch the sparks run from the keys on the left to the display on the right.',
    'Each block does one job. Scroll to zoom into any block, for example the ALU, then into its gates and transistors.',
    'The clock runs by itself while the chip is working. Pause it and press Space to go one tick at a time. Drag Speed to slow time down.',
    'Zoom into the control unit to see its rulebook. The rule that is working right now lights up.',
    'Click "Real chip" at the top right to see how the chip is really built. Each block takes room in proportion to its transistors.',
  ],
  help: 'Keys: 0–9, + − = (or Enter), C (Esc or Delete), M (m), MR (r). Scroll to zoom, drag to move, double-click to fly to a part, Backspace zooms out, Home fits the view.',
  totalTransistors: (n: number) => `Transistors in this calculator: ${n.toLocaleString('en-US')}`,
  viewTransistors: (n: number) => `Transistors in view: ${n.toLocaleString('en-US')}`,
  transistorNote: 'The display table and the rulebook count as their transistor grids would be built.',
};

export const calculatorTips = {
  keyTitle: (label: string) => `Key ${label}`,
  key: 'Pressing a key puts 1 on its key line. The keyboard encoder turns the line into a 4-bit code at once; the next clock tick stores it.',
  keyQueued: 'Waiting: the calculator is still busy with the last key.',
  displayTitle: 'Display',
  display: 'Seven-segment digits: sign, hundreds, tens and ones. Each wire lights one segment. The M lamp shows that memory is not zero.',
  clockTitle: 'Clock',
  clock: 'The clock pulses 0 → 1 → 0 on every tick. All registers load at the moment it rises.',
  clockHint: 'Click it or press Space for one tick.',
  activeRule: (ids: string[]) => (ids.length ? `Active rule: ${ids.join(', ')}` : 'No rule active'),
  activeRow: (id: string) => `Active row: X = ${id}`,
  tableHint: 'Zoom in to read the table; the active row lights up.',
};

/** Captions above the blocks of the chip, readable from the overview. */
export const blockCaptions: Record<string, string> = {
  enc: 'Keyboard encoder',
  keyreg: 'KEY register',
  cls: 'Key class decoder',
  ctrl: 'Control unit',
  const0: '0',
  flags: 'Flags',
  xmux: 'X input mux',
  xreg: 'X register',
  yreg: 'Y register',
  mreg: 'M register',
  alu: 'ALU',
  zd: 'Zero detect',
  rom: 'Display ROM',
  mlamp: 'M lamp',
  err: 'Err switch',
  segH: '7-seg',
  segT: '7-seg',
  segO: '7-seg',
};

/** Shown on the mini-calculator HUD. */
export const hudText = {
  label: 'Calculator',
  waiting: 'Waiting:',
  waitingTitle: 'Keys pressed while the calculator was busy. They go in one by one (this queue is not part of the chip).',
  mTitle: 'M lamp: memory is not zero',
};

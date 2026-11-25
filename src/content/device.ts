// Device world text (DESIGN.md §2, §6.2, §6.2a). Plain English, ages 12+, ≤ 40 words per step.

export const devicePanel = {
  steps: [
    'Type 2 + 3 = on your keyboard, or click the keys. The calculator works like a normal one.',
    'How did it know the answer? Click "Look inside" to take the cover off.',
    'Hover over the parts on the circuit board. Then click "Into the chip" to dive into the chip that does the thinking.',
  ],
  help: 'Keys: 0–9, + − = (or Enter), C (Esc or Delete), M (m), MR (r). Scroll on the calculator to look inside.',
};

export const deviceText = {
  prompt: 'Type 2 + 3 = on your keyboard.',
  promptOpen: 'Hover over the parts. The black chip does all the work.',
  lookInside: 'Look inside ▸',
  closeCover: '◂ Close the cover',
  intoChip: 'Into the chip ▸',
  crumbDevice: 'Calculator',
  /** Name in the Explore menu. */
  button: 'Pocket calculator',
  crumbBoard: 'Circuit board',
};

export interface PropText {
  title: string;
  body: string;
}

/** Hover text of the parts on the circuit board. Each says honestly what is and is not simulated. */
export const propText: Record<string, PropText> = {
  chip: {
    title: 'The calculator chip',
    body: 'All the thinking happens in here: about 7,000 transistors in our design. Click "Into the chip" to see them work.',
  },
  capacitor: {
    title: 'Decoupling capacitor',
    body: 'A tiny charge store next to the chip. It smooths the power when thousands of transistors switch at once. A prop: it is not simulated.',
  },
  resistor: {
    title: 'Pull-down resistor',
    body: 'Holds a key line at 0 while its key is not pressed, so the wire never floats. A prop: the simulation treats the line as a clean 0 or 1.',
  },
  contacts: {
    title: 'Keypad contacts',
    body: 'When you press a key, a carbon pad under it touches these two combs and connects the key line to power: the line becomes 1.',
  },
  battery: {
    title: 'Coin-cell battery',
    body: 'Gives the power: 1 means "near the battery voltage", 0 means "near 0 volts". A prop: the simulation only knows 0 and 1.',
  },
  die: {
    title: 'The silicon die',
    body: 'The chip itself: a thin slice of silicon smaller than your fingernail. Gold wires join its edge to the pins of the package.',
  },
  display: {
    title: 'Display',
    body: 'Seven-segment digits: sign, hundreds, tens and ones. The chip switches each segment on or off through its own wire.',
  },
  trace: {
    title: 'Copper traces',
    body: 'Thin copper paths on the board: the wires between the keys, the chip and the display.',
  },
  key: {
    title: 'Key',
    body: 'A rubber key. Pressing it closes the contacts underneath.',
  },
};

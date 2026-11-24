// Lab bench text (DESIGN.md §7.1: plain English for ages 12+, ≤ 40 words per panel step).

export interface BenchText {
  /** Component name in the library. */
  component: string;
  /** Button label. */
  label: string;
  title: string;
  /** Short panel steps, one idea each. */
  steps: string[];
  /** Ready-made inputs: bus values by bus name, single bits by pin name. */
  presets?: Preset[];
}

export interface Preset {
  label: string;
  values: Record<string, number>;
  /** Shown as the button's tooltip. */
  hint: string;
}

export const benchIntro = {
  heading: 'Lab bench',
  help: 'Click a switch (or press A, B) to flip an input. Scroll to zoom, drag to move. Double-click a part to fly to it, Backspace zooms out, Home goes back.',
};

export const busPanelText = {
  heading: 'Numbers',
  inputHint: 'Type a number from −128 to 127.',
  presetsHeading: 'Try these',
  overflow: 'Overflow! The answer does not fit in 8 bits.',
};

export const benches: BenchText[] = [
  {
    component: 'NOT',
    label: 'NOT',
    title: 'NOT: two switches',
    steps: [
      'A NOT gate flips its input. Flip switch A and watch the lamp do the opposite.',
      'Zoom into the gate. Inside are two transistors: a P-type on top and an N-type below.',
      'When A is 0, the top transistor conducts and connects the output to power (1). When A is 1, the bottom one connects it to ground (0).',
    ],
  },
  {
    component: 'NAND2',
    label: 'NAND',
    title: 'NAND: the Lego brick',
    steps: [
      'NAND gives 0 only when A and B are both 1. Try all four combinations.',
      'Zoom in. Two P-type transistors sit side by side: either one can connect the output to power.',
      'The two N-type transistors are in a line. Both must be on to connect the output to ground.',
    ],
  },
  {
    component: 'NOR2',
    label: 'NOR',
    title: 'NOR',
    steps: [
      'NOR gives 1 only when A and B are both 0. Try all four combinations.',
      'Zoom in. It is NAND turned around: now the P-type transistors are in a line, and the N-types side by side.',
    ],
  },
  {
    component: 'XOR2',
    label: 'XOR',
    title: 'XOR: are they different?',
    steps: [
      'XOR gives 1 when A and B are different. Adders use it to add bits.',
      'Zoom in: XOR is made of four NAND gates. Flip a switch and follow the sparks from gate to gate.',
      'Keep zooming into one NAND to see its four transistors switching.',
    ],
  },
  {
    component: 'AND2',
    label: 'AND',
    title: 'AND is secretly NAND + NOT',
    steps: [
      'AND gives 1 only when A and B are both 1.',
      'Zoom in to see how it is built. Chips usually make AND from a NAND followed by a NOT.',
    ],
  },
  {
    component: 'OR2',
    label: 'OR',
    title: 'OR is NOR + NOT',
    steps: [
      'OR gives 1 when A or B (or both) is 1.',
      'Zoom in: it is a NOR followed by a NOT.',
    ],
  },
  {
    component: 'HalfAdder',
    label: 'Half adder',
    title: 'Half adder: 1 + 1 = 10',
    steps: [
      'A half adder adds two bits. The answer is 0, 1 or 2, so it needs two output bits: sum and carry.',
      '1 + 1 = 2, which is 10 in binary: sum 0, carry 1. Try it.',
      'Zoom in: the sum comes from an XOR gate and the carry from an AND gate.',
    ],
  },
  {
    component: 'FullAdder',
    label: 'Full adder',
    title: 'Full adder: three bits',
    steps: [
      'A full adder adds three bits: A, B and CIN, the carry coming in from the bit before.',
      'The answer is 0 to 3, written as two bits: S (ones) and COUT (twos). Try 1 + 1 + 1.',
      'Zoom in: two half adders and an OR gate. The carry enters at the top and leaves at the bottom.',
    ],
  },
  {
    component: 'AddSub8',
    label: 'Adder/subtractor',
    title: '8-bit adder/subtractor',
    steps: [
      'Set A and B in the number boxes, or click the bit switches. R is the answer, in binary and as a number.',
      'Zoom in: eight full adders stacked up, one per bit. The carry from each bit flows down into the next.',
      'Pick −1 + 1 with slow motion on. Every bit makes a carry, so you can watch it ripple from bit 0 down to bit 7.',
      'Subtraction is a trick. SUB = 1 makes the XOR gates flip every bit of B, and adds 1 as the first carry. That gives A − B.',
      'V (overflow) lights up when the answer does not fit in −128 to 127. Try 127 + 1.',
    ],
    presets: [
      { label: '7 + 9', values: { A: 7, B: 9, sub: 0 }, hint: 'A small sum with a few carries.' },
      { label: '3 − 5', values: { A: 3, B: 5, sub: 1 }, hint: 'Subtract: B is flipped and 1 is added.' },
      { label: '−1 + 1', values: { A: -1, B: 1, sub: 0 }, hint: 'The longest carry ripple: through all 8 bits.' },
      { label: '127 + 1', values: { A: 127, B: 1, sub: 0 }, hint: 'Too big for 8 bits: overflow.' },
    ],
  },
];

export const slowMotionNote = 'Time slowed down about a billion times. The spark shows the signal changing, not electrons moving.';

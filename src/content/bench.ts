// Lab bench text (DESIGN.md §7.1: plain English for ages 12+, ≤ 40 words per panel step).

export interface BenchText {
  /** Component name in the library. */
  component: string;
  /** Button label. */
  label: string;
  title: string;
  /** Short panel steps, one idea each. */
  steps: string[];
}

export const benchIntro = {
  heading: 'Lab bench',
  help: 'Click a switch (or press A, B) to flip an input. Scroll to zoom in, drag to move, Home to go back.',
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
];

export const slowMotionNote = 'Time slowed down about a billion times. The spark shows the signal changing, not electrons moving.';

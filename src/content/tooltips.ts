// Hover tooltip text (DESIGN.md §2: name, one sentence, current value). Plain English, ages 12+.

export const tooltipText = {
  wire: 'A wire carries one bit: 1 (on) or 0 (off).',
  switch: 'An input switch. Click it to flip this bit.',
  lamp: 'An output lamp. It lights up when this bit is 1.',
  pmos: 'P-type transistor: a switch that conducts when its gate is 0. It can connect the output to power (1).',
  nmos: 'N-type transistor: a switch that conducts when its gate is 1. It can connect the output to ground (0).',
  capTitle: 'Load capacitance',
  cap: 'The output wire holds a tiny charge. Filling or emptying it takes time, which is why every gate has a delay.',
  capNote: 'Drawn to explain the delay; there is no real capacitor part here.',
  transistors: 'Transistors',
  on: 'on',
  off: 'off',
  conducting: 'switch closed: conducting',
  blocking: 'switch open: not conducting',
  zoomHint: 'Double-click to zoom in.',
};

/** One-sentence explanation of a named wire inside a component, if it has a special job. */
export function wireBlurb(component: string, net: string): string | null {
  const bit = /^[a-z]'?(\d)$/.exec(net)?.[1];
  const carry = /^c(\d)$/.exec(net)?.[1];
  switch (component) {
    case 'AddSub8':
      if (net === 'sub') return 'SUB: 0 adds, 1 subtracts. It flips the bits of B and is the first carry in.';
      if (net.startsWith("b'")) return `Bit ${bit} of B after the XOR: flipped when SUB is 1.`;
      if (/^r\d$/.test(net)) return `Bit ${bit} of the result R.`;
      if (net === 'c7') return 'The carry into bit 7. Compared with the carry out, it shows overflow.';
      if (net === 'c8') return 'The carry out of bit 7.';
      if (net === 'V') return 'Overflow (V): 1 when the answer does not fit in −128 to 127.';
      break;
    case 'Adder8':
      if (net === 'c0') return 'The carry into bit 0.';
      if (net === 'c8') return 'The carry out of bit 7: the answer did not fit in 8 bits.';
      if (/^s\d$/.test(net)) return `Bit ${bit} of the sum S.`;
      if (carry) return `The carry from bit ${Number(carry) - 1} into bit ${carry}. Carries ripple down, one bit after another.`;
      break;
    case 'FullAdder':
      if (net === 'a+b') return 'The sum of a and b, before the carry coming in is added.';
      if (net === 'carry1' || net === 'carry2') return 'A carry from one half adder. If either half adder carries, so does the full adder.';
      if (net === 'cin') return 'The carry coming in from the bit before.';
      if (net === 'cout') return 'The carry going out to the next bit.';
      if (net === 'sum') return 'The sum bit of a + b + carry in.';
      break;
    case 'HalfAdder':
      if (net === 'sum') return 'The sum bit: 1 when exactly one input is 1 (XOR).';
      if (net === 'carry') return 'The carry bit: 1 when both inputs are 1 (AND).';
      break;
  }
  return null;
}

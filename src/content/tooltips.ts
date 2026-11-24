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
  clockTitle: 'Clock',
  clock: 'The clock. On every tick it pulses 0 → 1 → 0. Flip-flops store their input at the moment it rises.',
  clockHint: 'Click it, press Space or use Step to make one tick.',
  behaviour: 'To save work, the calculator simulates it as one block. Zoomed in, its real gates are replayed from the signals at its pins.',
};

/** One-sentence explanation of a named wire inside a component, if it has a special job. */
export function wireBlurb(component: string, net: string): string | null {
  const bit = /^[a-z]'?(\d)$/.exec(net)?.[1];
  const carry = /^c(\d)$/.exec(net)?.[1];
  switch (component) {
    case 'SRLatch':
      if (net === 'q') return 'Q: the stored bit. It also feeds the other NOR gate, which keeps it stored.';
      if (net === 'qn') return 'QN ("not Q"): always the opposite of Q, except when S and R are both 1.';
      break;
    case 'DLatch':
      if (net === 'q') return 'Q: the stored bit. It loops back through the lower NAND gate to hold itself.';
      if (net === 'qn') return 'QN ("not Q"): the opposite of Q. It loops back to hold Q.';
      if (net === 'n1' || net === 'n2') return 'While E is 0, this is 1 and the latch keeps its bit. While E is 1, it passes D in.';
      break;
    case 'DFF':
      if (net === 'm') return 'The master latch\'s output. It follows D while the clock is 0, and freezes when the clock rises.';
      if (net === 'not clk') return 'The clock, flipped. It opens the master latch while the clock is 0.';
      if (net === 'clk') return 'The clock. It opens the slave latch while it is 1.';
      if (net === 'q') return 'Q: the stored bit, from the slave latch.';
      break;
    case 'RegBit':
      if (net === 'next') return 'The bit the flip-flop will store at the next tick: D if LOAD is 1, else its own Q.';
      if (net === 'q') return 'Q: the stored bit. It also loops back, so the bit can be kept.';
      if (net === 'load') return 'LOAD: 1 = take D at the next tick, 0 = keep the stored bit.';
      break;
    case 'Register8':
      if (net === 'clk') return 'The clock goes to every bit, so all eight load at the same moment.';
      if (net === 'load') return 'LOAD goes to every bit: 1 = load D at the next tick, 0 = keep.';
      if (/^q\d$/.test(net)) return `Bit ${bit} of the stored number Q.`;
      if (/^d\d$/.test(net)) return `Bit ${bit} of the input D.`;
      break;
    case 'MUX2':
      if (net === 'not s') return 'The select input, flipped. It lets input a through while s is 0.';
      break;
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

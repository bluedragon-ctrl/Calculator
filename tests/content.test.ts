// CLAUDE.md: student-facing text is plain English, ≤ 40 words per panel step.
import { describe, expect, it } from 'vitest';
import { benches, benchIntro } from '../src/content/bench';
import { tooltipText, wireBlurb } from '../src/content/tooltips';
import { library } from '../src/circuits/library';
import { calculatorPanel, calculatorTips, hudText } from '../src/content/calculator';
import { clockText } from '../src/content/messages';

const words = (s: string) => s.trim().split(/\s+/).length;

describe('student-facing text', () => {
  it('keeps every bench step and help text to ≤ 40 words', () => {
    for (const b of benches) for (const s of b.steps) expect(words(s), s).toBeLessThanOrEqual(40);
    expect(words(benchIntro.help)).toBeLessThanOrEqual(40);
  });
  it('keeps the calculator panel, tooltips and HUD text short', () => {
    for (const s of calculatorPanel.steps) expect(words(s), s).toBeLessThanOrEqual(40);
    expect(words(calculatorPanel.help)).toBeLessThanOrEqual(40);
    for (const s of [...Object.values(calculatorTips), ...Object.values(hudText), ...Object.values(clockText)]) {
      if (typeof s === 'string') expect(words(s), s).toBeLessThanOrEqual(40);
    }
  });
  it('keeps tooltips short', () => {
    for (const s of Object.values(tooltipText)) expect(words(s)).toBeLessThanOrEqual(40);
    for (const n of library.names()) expect(words(library.get(n).blurb), n).toBeLessThanOrEqual(40);
  });
  it('every bench uses a component in the library, and presets name real buses or pins', () => {
    for (const b of benches) {
      const def = library.get(b.component);
      for (const p of b.presets ?? []) {
        for (const k of Object.keys(p.values)) expect(!!def.buses?.[k] || !!def.pins[k], `${b.component}: ${k}`).toBe(true);
      }
    }
  });
  it('explains the special wires of the adders', () => {
    expect(wireBlurb('Adder8', 'c3')).toMatch(/bit 2 into bit 3/);
    expect(wireBlurb('AddSub8', "b'5")).toMatch(/Bit 5 of B/);
    expect(wireBlurb('AddSub8', 'sub')).toMatch(/subtracts/);
    expect(wireBlurb('XOR2', 'n1')).toBeNull();
  });
});

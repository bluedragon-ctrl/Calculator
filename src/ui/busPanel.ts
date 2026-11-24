// Number controls for benches with buses (e.g. the 8-bit adder/subtractor): type A and B,
// flip single-bit inputs such as SUB, read the result in decimal and binary.
import { busPanelText as T, type BenchText } from '../content/bench';
import { binaryString, numberToBits } from '../sim/bus';
import { inputPins, outputPins } from '../sim/library';
import { CLOCK_PIN } from '../sim/simulator';
import type { Bit } from '../sim/types';
import type { Bench } from '../render/bench';
import { clampSigned, formatBit, formatNumber, parseNumber } from './format';

export class BusPanel {
  private readonly updaters: (() => void)[] = [];

  constructor(private readonly host: HTMLElement, private readonly bench: Bench, text: BenchText) {
    host.replaceChildren();
    const buses = bench.def.buses;
    host.hidden = !buses;
    if (!buses) return;
    const def = bench.def;
    const inBus = new Set(Object.values(buses).flatMap((b) => b.pins));

    const h = document.createElement('h3');
    h.textContent = T.heading;
    host.append(h);

    const grid = document.createElement('div');
    grid.className = 'bus-grid';
    host.append(grid);
    const row = (label: string, control: HTMLElement, extra?: HTMLElement) => {
      const l = document.createElement('label');
      l.textContent = label;
      grid.append(l, control, extra ?? document.createElement('span'));
      return l;
    };

    for (const [name, bus] of Object.entries(buses)) {
      if (def.pins[bus.pins[0]].dir !== 'in') continue;
      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'numeric';
      input.size = 5;
      input.title = T.inputHint;
      input.setAttribute('aria-label', `${name} (number)`);
      const bin = document.createElement('code');
      const apply = () => {
        const v = parseNumber(input.value);
        if (v === null) return;
        const bits = numberToBits(clampSigned(v, bus.pins.length), bus.pins.length);
        const values: Record<string, Bit> = {};
        bus.pins.forEach((p, i) => (values[p] = bits[i]));
        bench.setInputs(values);
      };
      input.addEventListener('change', apply);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') apply();
        e.stopPropagation(); // typing digits must not reach the global shortcuts
      });
      const l = row(name, input, bin);
      l.htmlFor = input.id = `bus-${name}`;
      this.updaters.push(() => {
        const { value, bits } = bench.bus(name);
        if (document.activeElement !== input) input.value = formatNumber(value);
        bin.textContent = binaryString(bits);
      });
    }
    // Single-bit inputs get toggles; the clock is driven by the clock bar instead.
    for (const pin of inputPins(def).filter((p) => !inBus.has(p) && p !== CLOCK_PIN)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.addEventListener('click', () => bench.toggle(pin));
      row(pin.toUpperCase(), btn);
      this.updaters.push(() => {
        const v = bench.sim.input(pin);
        btn.textContent = formatBit(v);
        btn.setAttribute('aria-pressed', String(v === 1));
      });
    }
    for (const [name, bus] of Object.entries(buses)) {
      if (def.pins[bus.pins[0]].dir !== 'out') continue;
      const out = document.createElement('output');
      const bin = document.createElement('code');
      row(name, out, bin);
      this.updaters.push(() => {
        const { value, bits } = bench.bus(name);
        out.textContent = formatNumber(value);
        bin.textContent = binaryString(bits);
      });
    }
    for (const pin of outputPins(def).filter((p) => !inBus.has(p))) {
      const out = document.createElement('output');
      row(pin.toUpperCase(), out);
      this.updaters.push(() => (out.textContent = formatBit(bench.outputValue(pin))));
    }
    const note = document.createElement('p');
    note.className = 'overflow-note';
    host.append(note);
    // Components with an overflow output (V) explain it in words when it lights up.
    if (def.pins.v) this.updaters.push(() => (note.textContent = bench.outputValue('v') ? T.overflow : ''));

    if (text.presets?.length) {
      const ph = document.createElement('h3');
      ph.textContent = T.presetsHeading;
      const box = document.createElement('div');
      box.className = 'presets';
      for (const p of text.presets) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = p.label;
        b.title = p.hint;
        b.addEventListener('click', () => this.applyPreset(p.values));
        box.append(b);
      }
      host.append(ph, box);
    }
    this.update();
  }

  private applyPreset(values: Record<string, number>): void {
    const def = this.bench.def;
    const out: Record<string, Bit> = {};
    for (const [k, v] of Object.entries(values)) {
      const bus = def.buses?.[k];
      if (bus) numberToBits(v, bus.pins.length).forEach((b, i) => (out[bus.pins[i]] = b));
      else out[k] = (v ? 1 : 0) as Bit;
    }
    this.bench.setInputs(out);
  }

  update(): void {
    if (this.host.hidden) return;
    for (const u of this.updaters) u();
  }
}

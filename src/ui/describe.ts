// Hover tooltip contents: name, one sentence, current value (DESIGN.md §2).
import { tooltipText as T, wireBlurb } from '../content/tooltips';
import { busValue } from '../sim/bus';
import { inputPins, outputPins } from '../sim/library';
import { CLOCK_PIN } from '../sim/simulator';
import type { Bench, BenchHit } from '../render/bench';
import type { ChipHit, ChipView } from '../render/chip';
import { calculatorTips as C } from '../content/calculator';
import { KEY_LABELS } from '../circuits/machine';
import type { ComponentView } from '../render/views';
import { formatBit, formatBus } from './format';

export interface TooltipContent {
  title: string;
  body: string;
  /** Value lines (decimal + binary for buses). */
  values: string[];
  hint?: string;
}

/** Bus lines for an instance plus the single pins that are not part of a bus. */
function pinLines(view: ComponentView): string[] {
  const lines: string[] = [];
  const inBus = new Set<string>();
  for (const [name, bus] of Object.entries(view.def.buses ?? {})) {
    const { value, bits } = busValue(bus, (p) => view.pinValue(p));
    lines.push(formatBus(name, value, bits));
    for (const p of bus.pins) inBus.add(p);
  }
  const list = (pins: string[]) => pins.filter((p) => !inBus.has(p)).map((p) => `${p} = ${view.pinValue(p)}`).join(', ');
  const ins = list(inputPins(view.def));
  const outs = list(outputPins(view.def));
  if (ins) lines.push(`In: ${ins}`);
  if (outs) lines.push(`Out: ${outs}`);
  return lines;
}

/** If a wire carries a bit of one of the instance's buses, say which. */
function busOfNet(view: ComponentView, net: number): string | null {
  if (view.isBehavioural) return null; // its wires belong to the local copy (other net ids)
  for (const [name, bus] of Object.entries(view.def.buses ?? {})) {
    const i = bus.pins.findIndex((p) => view.netOfPin(p) === net);
    if (i >= 0) {
      const { value, bits } = busValue(bus, (p) => view.pinValue(p));
      return `Bit ${i} of ${formatBus(name, value, bits)}`;
    }
  }
  return null;
}

/** Active rule or row of a ROM/PLA instance. */
function tableLines(view: ComponentView): string[] {
  const t = view.def.table;
  if (!t) return [];
  const ids = view.activeRows.map((r) => t.ids[r]);
  if (t.kind === 'pla') return [C.activeRule(ids)];
  return ids.map((id) => C.activeRow(t.rows[Number(id)][0]));
}

export function describe(hit: BenchHit | ChipHit, host: Bench | ChipView): TooltipContent {
  switch (hit.kind) {
    case 'component': {
      const v = hit.view;
      return {
        title: v.displayName,
        body: v.isBehavioural ? `${v.def.blurb} ${T.behaviour}` : v.def.blurb,
        values: [...tableLines(v), ...pinLines(v)],
        hint: v.def.table && !v.isExpanded ? C.tableHint : v.canExpand && !v.isExpanded ? T.zoomHint : undefined,
      };
    }
    case 'key':
      return {
        title: C.keyTitle(KEY_LABELS[hit.code]),
        body: C.key,
        values: [`Key code ${hit.code} = ${hit.code.toString(2).padStart(4, '0')}`, `Key line = ${formatBit(hit.value)}`, ...(hit.queued ? [C.keyQueued] : [])],
      };
    case 'clock':
      return { title: C.clockTitle, body: C.clock, values: [`Clock = ${formatBit(hit.value)}`], hint: C.clockHint };
    case 'display':
      return { title: C.displayTitle, body: C.display, values: [] };
    case 'wire': {
      const value = hit.view.wireValue(hit.net);
      const bus = busOfNet(hit.view, hit.net);
      return {
        title: `Wire ${hit.name}`,
        body: wireBlurb(hit.view.def.name, hit.name) ?? T.wire,
        values: [`Value: ${formatBit(value)}`, ...(bus ? [bus] : [])],
      };
    }
    case 'fet': {
      const p = hit.fet.type === 'p';
      return {
        title: `${p ? 'P' : 'N'}-type transistor (gate: ${hit.fet.input})`,
        body: p ? T.pmos : T.nmos,
        values: [`Gate ${hit.fet.input} = ${hit.gate} → ${hit.on ? T.conducting : T.blocking}`],
      };
    }
    case 'cap':
      return {
        title: T.capTitle,
        body: `${T.cap} ${T.capNote}`,
        values: [`Charge: ${Math.round(hit.charge * 100)}%`],
      };
    case 'switch':
    case 'lamp': {
      const bench = host as Bench;
      const bus = Object.entries(bench.def.buses ?? {}).find(([, b]) => b.pins.includes(hit.pin));
      const values = [`${hit.pin.toUpperCase()} = ${formatBit(hit.value)}`];
      if (bus) {
        const { value, bits } = bench.bus(bus[0]);
        values.push(`Bit ${bus[1].pins.indexOf(hit.pin)} of ${formatBus(bus[0], value, bits)}`);
      }
      if (hit.kind === 'switch' && hit.pin === CLOCK_PIN) {
        return { title: T.clockTitle, body: T.clock, values, hint: T.clockHint };
      }
      return {
        title: `${hit.kind === 'switch' ? 'Input' : 'Output'} ${hit.pin.toUpperCase()}`,
        body: hit.kind === 'switch' ? T.switch : T.lamp,
        values,
      };
    }
  }
}

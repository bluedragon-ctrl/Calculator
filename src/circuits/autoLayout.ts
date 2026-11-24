// Automatic column layout for larger schematics (DESIGN.md §8.1: "nets without a route get simple
// automatic orthogonal routing"). Pure geometry: no rendering imports.
//
// Parts are placed in columns (left → right, data flows right). Between two columns lies a
// routing channel; every net that passes a channel gets its own vertical track there, so wires
// of different nets never run along each other. Horizontal wires:
//   - a driver's output runs right to its track in the next channel;
//   - from a track a wire runs right into a sink's input pin;
//   - to reach a later column, a net crosses the columns in between through the gaps between
//     parts ("feed-throughs");
//   - nets that go back to an earlier column (feedback, e.g. a register's output into the mux
//     in front of it) run along their own row in the top margin.
// The component's own inputs are on the left edge, its outputs on the right edge, placed so
// that their wires are straight.
import { splitRef, type Library } from '../sim/library';
import type { ComponentDef, NetDef, PinRef, Point } from '../sim/types';

export interface AutoPart {
  type: string;
  /** Column (any numbers; only their order matters). Parts in a column stack top-down in listed order. */
  col: number;
  label?: string;
}

export interface AutoNet {
  from: PinRef;
  to: PinRef[];
  name?: string;
}

export interface AutoSpec {
  name: string;
  title: string;
  blurb: string;
  /** Own input pins, top to bottom (all on the left edge). */
  inputs: string[];
  /** Own output pins (all on the right edge; their height follows the wires). */
  outputs: string[];
  parts: Record<string, AutoPart>;
  nets: AutoNet[];
  innerScale?: number;
  /** Distance between neighbouring tracks and feed-throughs (inner units). Default 0.5. */
  pitch?: number;
  /** Smallest gap between two parts of a column. Default 1. */
  gap?: number;
  /** Extra space above and below the columns. Default 1. */
  margin?: number;
  /** Extra space added to the width of every channel. Default 0.5. */
  channelPad?: number;
  /** Extra space between consecutive parts of a column, per part name (added above that part). */
  spaceAbove?: Record<string, number>;
  /** Copied to the component. */
  extra?: Partial<Pick<ComponentDef, 'buses' | 'powerOn' | 'behavior' | 'simulateAs'>>;
}

interface Sink {
  ref: PinRef;
  col: number;
  /** Part name (null for an own output pin). */
  part: string | null;
  side: 'left' | 'top' | 'right';
}

interface NetInfo {
  net: AutoNet;
  driverCol: number;
  sinks: Sink[];
  /** Columns crossed through a gap (forward path). */
  ftCols: number[];
  /** Has sinks at or before the driver's column (routed through the top margin). */
  backward: boolean;
  /** Channels with a track for this net. */
  channels: Set<number>;
}

const EPS = 1e-6;

export function autoLayout(spec: AutoSpec, lib: Library): ComponentDef {
  const pitch = spec.pitch ?? 0.5;
  const minGap = spec.gap ?? 1;
  const margin = spec.margin ?? 1;
  const pad = spec.channelPad ?? 0.5;
  const s = spec.innerScale ?? 1;
  const fail = (m: string): never => {
    throw new Error(`autoLayout ${spec.name}: ${m}`);
  };

  // --- Columns ---
  const colValues = [...new Set(Object.values(spec.parts).map((p) => p.col))].sort((a, b) => a - b);
  const C = colValues.length;
  const colOf = new Map<string, number>();
  const colParts: string[][] = Array.from({ length: C + 2 }, () => []);
  for (const [name, p] of Object.entries(spec.parts)) {
    const c = colValues.indexOf(p.col) + 1;
    colOf.set(name, c);
    colParts[c].push(name);
  }
  const partDef = (name: string) => lib.get(spec.parts[name].type);
  const colWidth = colParts.map((names) => Math.max(0, ...names.map((n) => partDef(n).size[0])));

  // --- Topology ---
  const infos: NetInfo[] = spec.nets.map((net) => {
    const { part: dp, pin: dpin } = splitRef(net.from);
    let driverCol = 0;
    if (dp !== null) {
      driverCol = colOf.get(dp) ?? fail(`unknown part in ${net.from}`);
      const side = partDef(dp).pins[dpin]?.side;
      if (side !== 'right') fail(`driver ${net.from} must be on the right side`);
    } else if (!spec.inputs.includes(dpin)) fail(`${net.from} is not an input`);
    const sinks: Sink[] = net.to.map((ref) => {
      const { part, pin } = splitRef(ref);
      if (part === null) {
        if (!spec.outputs.includes(pin)) fail(`${ref} is not an output`);
        return { ref, col: C + 1, part: null, side: 'right' };
      }
      const side = partDef(part).pins[pin]?.side ?? fail(`unknown pin ${ref}`);
      if (side !== 'left' && side !== 'top') fail(`sink ${ref} must be on the left or top side`);
      return { ref, col: colOf.get(part)!, part, side: side as 'left' | 'top' };
    });
    const fwd = sinks.filter((k) => k.col > driverCol);
    const maxF = Math.max(driverCol, ...fwd.map((k) => k.col));
    const ftCols: number[] = [];
    for (let j = driverCol + 1; j < maxF; j++) ftCols.push(j);
    const backward = sinks.some((k) => k.col <= driverCol);
    const channels = new Set<number>();
    for (let j = driverCol + 1; j <= maxF; j++) channels.add(j);
    if (backward) {
      channels.add(driverCol + 1);
      for (const k of sinks) if (k.col <= driverCol) channels.add(k.col);
    }
    return { net, driverCol, sinks, ftCols, backward, channels };
  });

  // --- Horizontal positions ---
  const tracksIn = Array.from({ length: C + 2 }, () => 0);
  for (const info of infos) for (const c of info.channels) tracksIn[c]++;
  const chLeft: number[] = new Array(C + 2).fill(0);
  const colX: number[] = new Array(C + 2).fill(0);
  let x = 0;
  for (let j = 1; j <= C + 1; j++) {
    chLeft[j] = x;
    x += (tracksIn[j] + 1) * pitch + pad;
    colX[j] = x;
    x += colWidth[j];
  }
  const W = colX[C + 1];

  // --- Vertical placement, column by column ---
  /** y of each net where it enters a channel from the left (driver stub or feed-through). */
  const entryY: Map<number, number>[] = Array.from({ length: C + 2 }, () => new Map());
  /** Feed-through y of a net through a column. */
  const ftY: Map<number, number>[] = Array.from({ length: C + 2 }, () => new Map());
  /** Reserved horizontal y for a top pin, by sink ref. */
  const topY = new Map<PinRef, number>();
  const partTop = new Map<string, number>();
  const netIndex = new Map(infos.map((inf, i) => [inf, i]));
  const sinkRefNet = new Map<PinRef, number>();
  infos.forEach((inf, i) => inf.net.to.forEach((r) => sinkRefNet.set(r, i)));
  const inputNet = new Map<string, number>();
  infos.forEach((inf, i) => {
    if (inf.driverCol === 0) inputNet.set(splitRef(inf.net.from).pin, i);
  });
  const inputY = new Map<string, number>();
  let maxBottom = 0;

  const pinY = (part: string, pin: string, top: number) => top + partDef(part).pins[pin].at;

  for (let j = 1; j <= C; j++) {
    const parts = colParts[j];
    const n = parts.length;
    const through = infos.map((inf, i) => [inf, i] as const).filter(([inf]) => inf.ftCols.includes(j));
    const reserves = parts.map((p) => Object.entries(partDef(p).pins).filter(([, pd]) => pd.dir === 'in' && pd.side === 'top').length);

    // Preferred heights of the feed-throughs: where they enter this column's channel.
    const prefOf = (i: number, tops: number[]): number => {
      const e = entryY[j].get(i);
      if (e !== undefined) return e;
      // An own input with no sink in column 1: follow the previous input in the list.
      const inp = splitRef(infos[i].net.from).pin;
      const k = spec.inputs.indexOf(inp);
      for (let q = k - 1; q >= 0; q--) {
        const ni = inputNet.get(spec.inputs[q]);
        if (ni === undefined) continue;
        const sk = infos[ni].sinks.find((z) => z.col === 1 && z.part);
        if (sk) return pinY(sk.part!, splitRef(sk.ref).pin, tops[parts.indexOf(sk.part!)]) + 0.01;
      }
      return -1;
    };

    let assign = new Map<number, number>(); // net index → gap index
    let tops: number[] = [];
    let gapH: number[] = [];
    const layoutTops = () => {
      const count = Array.from({ length: n + 1 }, (_, g) => [...assign.values()].filter((v) => v === g).length);
      gapH = count.map((c, g) => {
        const r = g < n ? reserves[g] : 0;
        const k = c + r;
        const extra = g < n ? spec.spaceAbove?.[parts[g]] ?? 0 : 0;
        if (g === 0 || g === n) return margin + (k ? (k + 0.5) * pitch : 0) + extra;
        return Math.max(minGap, (k + 1) * pitch) + extra;
      });
      tops = [];
      let y = 0;
      for (let g = 0; g < n; g++) {
        y += gapH[g];
        tops.push(y);
        y += partDef(parts[g]).size[1];
      }
      return y + gapH[n];
    };
    layoutTops();
    for (let iter = 0; iter < 4; iter++) {
      const next = new Map<number, number>();
      for (const [, i] of through) {
        const pref = prefOf(i, tops);
        let best = 0;
        let bestD = Infinity;
        for (let g = 0; g <= n; g++) {
          const g0 = g === 0 ? 0 : tops[g - 1] + partDef(parts[g - 1]).size[1];
          const g1 = g === n ? g0 + gapH[n] : tops[g];
          const d = pref < g0 ? g0 - pref : pref > g1 ? pref - g1 : 0;
          if (d < bestD - EPS) {
            best = g;
            bestD = d;
          }
        }
        next.set(i, best);
      }
      assign = next;
      layoutTops();
    }
    const height = layoutTops();

    // Slot heights inside each gap (feed-throughs in order of preference, top-pin reservation last).
    const slotsFor = (delta: number) => {
      const ys = new Map<number, number>();
      const res = new Map<PinRef, number>();
      for (let g = 0; g <= n; g++) {
        const g1 = (g === n ? height : tops[g]) + delta;
        const nets = [...assign.entries()].filter(([, v]) => v === g).map(([i]) => i)
          .sort((a, b) => prefOf(a, tops) - prefOf(b, tops));
        const r = g < n ? Object.entries(partDef(parts[g]).pins).filter(([, pd]) => pd.dir === 'in' && pd.side === 'top') : [];
        const k = nets.length + r.length;
        // Bottom margin: fill from its top; other gaps: fill upward from the part below.
        const base = g === n ? (g === 0 ? delta : tops[n - 1] + partDef(parts[n - 1]).size[1] + delta) : g1;
        nets.forEach((i, q) => ys.set(i, g === n ? base + (q + 1) * pitch : base - (k - q) * pitch));
        r.forEach(([pin], q) => res.set(`${parts[g]}.${pin}`, base - (r.length - q) * pitch));
      }
      return { ys, res };
    };

    // Pick a small vertical offset so no wire of this column lines up with a different net's
    // wire entering the channel (they would overlap).
    const entering = [...entryY[j].entries()];
    let bestDelta = 0;
    let bestScore = -Infinity;
    for (const delta of [0, 0.25, 0.5, 0.75, 0.125, 0.375, 0.625, 0.875].map((f) => f * pitch)) {
      const { ys, res } = slotsFor(delta);
      const right: [number, number][] = [];
      parts.forEach((p, q) => {
        for (const [pin, pd] of Object.entries(partDef(p).pins)) {
          if (pd.dir === 'in' && pd.side === 'left') right.push([sinkRefNet.get(`${p}.${pin}`)!, tops[q] + delta + pd.at]);
        }
      });
      for (const [i, y] of ys) right.push([i, y]);
      for (const [ref, y] of res) right.push([sinkRefNet.get(ref)!, y]);
      let score = Infinity;
      if (j > 1) {
        for (const [ri, ry] of right) for (const [li, ly] of entering) if (ri !== li) score = Math.min(score, Math.abs(ry - ly));
      }
      if (score > bestScore + EPS) {
        bestScore = score;
        bestDelta = delta;
      }
      if (j === 1) break;
    }
    const { ys, res } = slotsFor(bestDelta);
    parts.forEach((p, q) => partTop.set(p, tops[q] + bestDelta));
    for (const [i, y] of ys) ftY[j].set(i, y);
    for (const [ref, y] of res) topY.set(ref, y);
    maxBottom = Math.max(maxBottom, height + bestDelta);

    if (j === 1) {
      // Own inputs: level with their first sink in column 1, or with their feed-through.
      for (const name of spec.inputs) {
        const i = inputNet.get(name);
        if (i === undefined) fail(`input ${name} is not connected`);
        const sk = infos[i!].sinks.find((k) => k.col === 1 && k.side === 'left');
        let y: number;
        if (sk) y = pinY(sk.part!, splitRef(sk.ref).pin, partTop.get(sk.part!)!);
        else if (ftY[1].has(i!)) y = ftY[1].get(i!)!;
        else {
          const tk = infos[i!].sinks.find((k) => k.col === 1)!;
          y = topY.get(tk.ref)!;
        }
        inputY.set(name, y);
        entryY[1].set(i!, y);
      }
    }

    // What enters the next channel: output stubs and feed-throughs.
    for (const p of parts) {
      for (const [pin, pd] of Object.entries(partDef(p).pins)) {
        if (pd.dir !== 'out') continue;
        const i = infos.findIndex((inf) => inf.net.from === `${p}.${pin}`);
        if (i < 0) fail(`${p}.${pin} is not connected`);
        entryY[j + 1].set(i, partTop.get(p)! + pd.at);
      }
    }
    for (const [i, y] of ftY[j]) entryY[j + 1].set(i, y);
  }

  // Own outputs: level with the wire arriving at the right edge.
  const outputY = new Map<string, number>();
  for (const name of spec.outputs) {
    const i = infos.findIndex((inf) => inf.net.to.includes(name));
    if (i < 0) fail(`output ${name} is not connected`);
    const y = entryY[C + 1].get(i);
    if (y === undefined) fail(`output ${name} has no wire reaching the right edge`);
    outputY.set(name, y!);
  }

  // --- Margin rows for feedback nets (above everything) ---
  const back = infos.map((inf, i) => [inf, i] as const).filter(([inf]) => inf.backward);
  // Rows in order of the driver's column (rightmost highest), so rows nest without crossing.
  back.sort(([a], [b]) => b.driverCol - a.driverCol || (entryY[a.driverCol + 1].get(netIndex.get(a)!)! - entryY[b.driverCol + 1].get(netIndex.get(b)!)!));
  const rowY = new Map<number, number>();
  back.forEach(([, i], k) => rowY.set(i, (k + 1) * pitch));
  const shift = back.length ? (back.length + 1) * pitch + margin : 0;
  const H = shift + maxBottom;

  // --- Tracks ---
  const trackX: Map<number, number>[] = Array.from({ length: C + 2 }, () => new Map());
  for (let j = 1; j <= C + 1; j++) {
    const here = infos.map((inf, i) => [inf, i] as const).filter(([inf]) => inf.channels.has(j));
    const key = ([inf, i]: readonly [NetInfo, number]) => {
      const fromLeft = entryY[j].get(i);
      const rights: number[] = [];
      for (const k of inf.sinks) {
        if (k.col !== j) continue;
        if (k.side === 'top') rights.push(topY.get(k.ref)!);
        else if (k.part) rights.push(partTop.get(k.part)! + partDef(k.part).pins[splitRef(k.ref).pin].at);
        else rights.push(outputY.get(k.ref)!);
      }
      const ft = ftY[j].get(i);
      if (ft !== undefined) rights.push(ft);
      const row = rowY.get(i);
      const entry = fromLeft ?? (row !== undefined ? row - shift : 0);
      if (fromLeft !== undefined && row !== undefined && j === inf.driverCol + 1) rights.push(row - shift);
      const mean = rights.length ? rights.reduce((a, b) => a + b, 0) / rights.length : entry;
      const down = mean >= entry;
      return down ? [0, -entry] : [1, entry];
    };
    here.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      return ka[0] - kb[0] || ka[1] - kb[1];
    });
    here.forEach(([, i], k) => trackX[j].set(i, chLeft[j] + (k + 1) * pitch));
  }

  // --- Emit the component ---
  const Y = (y: number) => y + shift;
  const parts: ComponentDef['parts'] = {};
  for (const [name, p] of Object.entries(spec.parts)) {
    parts[name] = { type: p.type, at: [colX[colOf.get(name)!], Y(partTop.get(name)!)], ...(p.label ? { label: p.label } : {}) };
  }
  const pins: ComponentDef['pins'] = {};
  for (const name of spec.inputs) pins[name] = { dir: 'in', side: 'left', at: Y(inputY.get(name)!) / s };
  for (const name of spec.outputs) pins[name] = { dir: 'out', side: 'right', at: Y(outputY.get(name)!) / s };

  const nets: NetDef[] = infos.map((inf, i) => {
    const routes: Record<PinRef, Point[]> = {};
    const d = inf.driverCol;
    const start = entryY[d + 1].get(i)!;
    for (const k of inf.sinks) {
      const pts: [number, number][] = [[trackX[d + 1].get(i)!, start]];
      let last: number = d + 1;
      if (k.col <= d) {
        const r = rowY.get(i)! - shift;
        pts.push([trackX[d + 1].get(i)!, r], [trackX[k.col].get(i)!, r]);
        last = k.col;
      } else {
        for (let j = d + 1; j < k.col; j++) {
          const f = ftY[j].get(i)!;
          pts.push([trackX[j].get(i)!, f], [trackX[j + 1].get(i)!, f]);
        }
        last = k.col;
      }
      const tx = trackX[last].get(i)!;
      if (k.side === 'top') pts.push([tx, topY.get(k.ref)!]);
      else if (k.part) pts.push([tx, partTop.get(k.part)! + partDef(k.part).pins[splitRef(k.ref).pin].at]);
      else pts.push([tx, outputY.get(k.ref)!]);
      routes[k.ref] = pts.map(([px, py]) => [px, Y(py)] as Point);
    }
    return { from: inf.net.from, to: inf.net.to, ...(inf.net.name ? { name: inf.net.name } : {}), routes };
  });

  return {
    name: spec.name,
    title: spec.title,
    blurb: spec.blurb,
    size: [W / s, H / s],
    innerScale: s,
    pins,
    parts,
    nets,
    ...spec.extra,
  };
}

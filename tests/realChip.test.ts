// "Diagram | Real chip" at every level (DESIGN.md §9, Phase 4c), run headless: the die view at
// chip level, cell miniatures on closed boxes, the rasterizer behind both, the LCD close-up and
// the dive. Troika text needs a browser, so it is replaced by an empty object here.
import { Object3D } from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('troika-three-text', () => ({
  Text: class extends Object3D {
    text = '';
    fontSize = 1;
    fillOpacity = 1;
    outlineWidth = 0;
    sync() {}
    dispose() {}
  },
}));
vi.mock('../src/assets/fonts/inter-latin-600-normal.woff?url', () => ({ default: '' }));

const { library } = await import('../src/circuits/library');
const { Machine, keyCodeFor } = await import('../src/circuits/machine');
const { ChipView } = await import('../src/render/chip');
const { Bench } = await import('../src/render/bench');
const { WireMaterials } = await import('../src/render/wires');
const { siliconLayout } = await import('../src/circuits/siliconLayout');
const { blockPlan } = await import('../src/circuits/dieLayout');
const { miniature, ART_COLORS } = await import('../src/render/dieArt');
const { Raster } = await import('../src/render/raster');
const { LcdCutaway } = await import('../src/render/lcdCutaway');
const { DeviceWorld } = await import('../src/render/device');

type Chip = InstanceType<typeof ChipView>;

function run(chip: Chip, view: { left: number; right: number; bottom: number; top: number; pxPerWorld: number }, frames = 30) {
  for (let i = 0; i < frames; i++) chip.update(100, view);
}

/** The chip world's home view as a visible rect. */
function homeRect(chip: Chip) {
  const v = chip.homeView(1.6);
  return { left: v.cx - (v.height * 1.6) / 2, right: v.cx + (v.height * 1.6) / 2, bottom: v.cy - v.height / 2, top: v.cy + v.height / 2, pxPerWorld: 800 / v.height };
}

/** Displayed value of every net of a chip view or bench. */
function values(host: { playback: { value(n: number): number }; circuit?: { netCount: number }; machine?: { circuit: { netCount: number } } }) {
  const n = (host.circuit ?? host.machine!.circuit).netCount;
  return Array.from({ length: n }, (_, i) => host.playback.value(i));
}

const close = (a: readonly number[], b: readonly number[], tol = 3) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

describe('rasterizer', () => {
  it('fills rectangles with anti-aliased edges, rows bottom first', () => {
    const r = new Raster(10, 10, [0, 0, 10, 10]);
    r.fill([2, 2, 5, 4], [1, 0, 0]);
    expect(r.pixel(3, 3)).toEqual([255, 0, 0, 255]);
    expect(r.pixel(8, 8)).toEqual([0, 0, 0, 0]);
    // Pixel row y = 2 (from the top) is texture row 7 (from the bottom).
    expect(r.data[(7 * 10 + 3) * 4]).toBe(255);
    const half = new Raster(4, 1, [0, 0, 4, 1]);
    half.fill([0, 0, 1.5, 1], [1, 1, 1]);
    expect(half.pixel(1.2, 0.5)[3]).toBeCloseTo(128, -1);
  });
});

describe('cell miniatures', () => {
  it('a gate\'s miniature is its tested silicon cell, filling the box', () => {
    for (const name of ['NOT', 'NAND2', 'NAND3', 'NAND4', 'NOR2', 'NOR3', 'NOR4']) {
      const def = library.get(name);
      const m = miniature(def, library)!;
      const layout = siliconLayout(def);
      expect(m.layout).toEqual(layout);
      // The cell's frame is the gate's inner frame, so it fills the closed box exactly.
      expect(layout.width / layout.height).toBeCloseTo(def.size[0] / def.size[1], 6);
      // Every contact of the layout is painted where the layout puts it.
      for (const s of layout.shapes.filter((x) => x.layer === 'contact')) {
        const [x0, y0, x1, y1] = s.rect;
        const px = m.raster.pixel((x0 + x1) / 2, (y0 + y1) / 2);
        expect(close(px.slice(0, 3), ART_COLORS.contact.map((c) => Math.round(c * 255))), `${name} contact`).toBe(true);
      }
      // …and the middle of each channel shows poly (it crosses the diffusion there).
      for (const f of layout.fets) {
        const [x0, y0, x1, y1] = f.channel;
        const px = m.raster.pixel((x0 + x1) / 2, (y0 + y1) / 2);
        expect(close(px.slice(0, 3), ART_COLORS.poly.map((c) => Math.round(c * 255))), `${name} channel`).toBe(true);
      }
    }
  });

  it('a composite\'s miniature is its gates as the same cells, in rows', () => {
    for (const name of ['XOR2', 'AND2', 'FullAdder', 'DFF', 'SevenSegDecoder']) {
      const def = library.get(name);
      const m = miniature(def, library)!;
      expect(m.plan).toEqual(blockPlan(def, library, [0, 0, def.size[0], def.size[1]]));
      for (const c of m.plan!.cells) expect(library.get(c.type).cmos, c.type).toBeDefined();
    }
    expect(miniature(library.get('XOR2'), library)!.plan!.cells.map((c) => c.type)).toEqual(['NAND2', 'NAND2', 'NAND2', 'NAND2']);
    // ROM: its stored-bit grid. The constant 0 is only a wire: nothing to draw.
    expect(miniature(library.get('DisplayROM'), library)!.plan!.arrays).toHaveLength(1);
    expect(miniature(library.get('CONST0'), library)).toBeNull();
  });

  it('closed gates show their cell in Real chip mode, and hovering says so', () => {
    const mode = { on: false };
    const bench = new Bench(library.get('XOR2'), library, new WireMaterials(), mode);
    const [l, b, r, t] = bench.view.worldBounds;
    const span = Math.max(r - l, t - b);
    // Zoomed so the XOR is open and its NAND gates are closed boxes.
    let view = null;
    for (let px = 1; px < 2000 && !view; px *= 1.1) {
      const v = { left: l - span, right: r + span, bottom: b - span, top: t + span, pxPerWorld: px };
      for (let i = 0; i < 20; i++) bench.update(1000, v);
      if (bench.view.showsGates) view = v;
    }
    expect(view).not.toBeNull();
    const n1 = bench.view.child('n1')!;
    expect(n1.isExpanded).toBe(false);
    expect(n1.showsMiniature).toBe(false);
    const [x0, y0, x1, y1] = n1.worldBounds;
    const mid = [(x0 + x1) / 2, (y0 + y1) / 2] as const;
    expect(bench.hit(...mid, 0.001)).toMatchObject({ kind: 'component' });
    const shown = values(bench);
    mode.on = true;
    for (let i = 0; i < 20; i++) bench.update(1000, view!);
    expect(n1.showsMiniature).toBe(true);
    expect(bench.hit(...mid, 0.001)).toMatchObject({ kind: 'cell' });
    expect(values(bench)).toEqual(shown);
    mode.on = false;
    for (let i = 0; i < 20; i++) bench.update(1000, view!);
    expect(n1.showsMiniature).toBe(false);
    bench.dispose();
  });
});

describe('die view at chip level', () => {
  it('replaces the block diagram when the toggle is on, without changing values or what is open', () => {
    const mode = { on: false };
    const machine = new Machine(library);
    const chip = new ChipView(machine, library, new WireMaterials(), mode);
    const view = homeRect(chip);
    run(chip, view);
    expect(chip.showsDie).toBe(false);
    expect(chip.dieView).toBeNull();
    const before = values(chip);
    const open = chip.view.isExpanded;
    mode.on = true;
    run(chip, view);
    expect(chip.showsDie).toBe(true);
    expect(chip.dieView!.opacity).toBe(1);
    expect(values(chip)).toEqual(before);
    expect(chip.view.isExpanded).toBe(open);
    mode.on = false;
    run(chip, view);
    expect(chip.showsDie).toBe(false);
    expect(chip.dieView!.opacity).toBe(0);
    expect(values(chip)).toEqual(before);
    chip.dispose();
  });

  it('hovering the die finds blocks and pads; blocks glow while they switch', () => {
    const mode = { on: true };
    const machine = new Machine(library);
    const chip = new ChipView(machine, library, new WireMaterials(), mode);
    const view = homeRect(chip);
    run(chip, view);
    const die = chip.dieView!;
    const [l, , , t] = chip.view.worldBounds;
    const k = 0.25; // world units per chip unit
    const world = ([x, y]: readonly [number, number]) => [l + x * k, t - y * k] as const;
    const centre = (r: readonly number[]) => [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2] as const;

    const alu = die.layout.regions.find((r) => r.part === 'alu')!;
    const h = chip.hit(...world(centre(alu.rect)), 0.001);
    expect(h).toMatchObject({ kind: 'component' });
    expect((h as { view: { def: { name: string } } }).view.def.name).toBe('AddSub8');
    const pad = die.layout.pads.find((p) => p.pin === 'k5')!;
    expect(chip.hit(...world(centre(pad.rect)), 0.001)).toMatchObject({ kind: 'pad', pin: 'k5', value: 0 });

    // Press 5: the key line changes first, then the encoder switches.
    expect(die.glowing).toEqual([]);
    chip.setSlowMotion(20);
    chip.press(keyCodeFor('5')!);
    for (let i = 0; i < 8; i++) chip.update(40, view);
    expect(die.glowing).toContain('enc');
    expect(chip.hit(...world(centre(pad.rect)), 0.001)).toMatchObject({ kind: 'pad', pin: 'k5', value: 1 });
    // Glowing fades once nothing changes any more.
    for (let i = 0; i < 100; i++) chip.update(100, view);
    expect(die.glowing).toEqual([]);
    chip.dispose();
  });

  it('gives way to the block diagram as soon as a block opens', () => {
    const mode = { on: true };
    const chip = new ChipView(new Machine(library), library, new WireMaterials(), mode);
    run(chip, homeRect(chip));
    expect(chip.showsDie).toBe(true);
    // Zoom onto the ALU's box until it opens.
    // (Only the ALU in view: the ROM's table view needs a browser canvas.)
    const [l, b, r, t] = chip.view.child('alu')!.worldBounds;
    run(chip, { left: l, right: r, bottom: b, top: t, pxPerWorld: 700 / (t - b) });
    expect(chip.view.child('alu')!.isExpanded).toBe(true);
    expect(chip.showsDie).toBe(false);
    chip.dispose();
  });

  it('keeps the chip overview cheap: one texture per block', () => {
    const chip = new ChipView(new Machine(library), library, new WireMaterials(), { on: true });
    run(chip, homeRect(chip), 2);
    let textured = 0;
    chip.dieView!.group.traverse((o) => {
      const m = (o as { material?: { map?: unknown } }).material;
      if (m?.map) textured++;
    });
    expect(textured).toBe(chip.dieView!.layout.regions.length + 1); // + the die base
    chip.dispose();
  });
});

describe('device world', () => {
  it('the LCD close-up follows its segment wire: rods stand up for 1, lie twisted for 0', () => {
    const lcd = new LcdCutaway();
    lcd.update(0, false);
    expect(lcd.rodsStanding).toBe(0);
    lcd.update(0.1, true);
    expect(lcd.rodsStanding).toBeGreaterThan(0);
    lcd.update(1, true);
    expect(lcd.rodsStanding).toBe(1);
    lcd.update(1, false);
    expect(lcd.rodsStanding).toBe(0);
    lcd.dispose();
  });

  it('the dive takes the lid off and hands over to the chip world', () => {
    const device = new DeviceWorld();
    let dived = 0;
    device.onDived = () => dived++;
    device.setSize(1600, 1000);
    device.setOpen(true);
    device.diveIn();
    for (let i = 0; i < 100 && !dived; i++) device.update(0.05, () => false, false);
    expect(dived).toBe(1);
    device.setLcdCutaway(true);
    expect(device.lcdCutaway).toBe(true);
    device.reset();
    expect(device.phase).toBe('closed');
  });
});

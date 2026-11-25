import './style.css';
import { library } from './circuits/library';
import { keyCodeFor, Machine } from './circuits/machine';
import { benches, benchIntro, slowMotionNote, type BenchGroup, type BenchText } from './content/bench';
import { calculatorPanel } from './content/calculator';
import { devicePanel, deviceText, propText } from './content/device';
import { calculatorTips } from './content/calculator';
import { KEY_LABELS } from './circuits/machine';
import { clockText, exploreText, noWebGL } from './content/messages';
import { tooltipText } from './content/tooltips';
import { Bench } from './render/bench';
import { ChipView } from './render/chip';
import { DeviceWorld } from './render/device';
import { FADE_SEC, fitView, type Bounds } from './render/lod';
import { Stage, hasWebGL2 } from './render/stage';
import type { ComponentView } from './render/views';
import { WireMaterials } from './render/wires';
import { transistorCount } from './sim/stats';
import type { ComponentDef } from './sim/types';
import { Breadcrumb, type Crumb } from './ui/breadcrumb';
import { BusPanel } from './ui/busPanel';
import { describe } from './ui/describe';
import { Hud } from './ui/hud';
import { Navigator } from './ui/navigation';
import { Tooltip } from './ui/tooltip';
import {
  QualityProbe, loadQualitySetting, nextQualitySetting, saveQualitySetting,
  type Quality, type QualitySetting,
} from './ui/quality';
import { CALCULATOR_SPEED, isInstant, speedLabel, speedToMs, speedToRate } from './ui/speed';
import { ClockRunner } from './ui/clock';
import { ClockBar } from './ui/clockBar';
import { ViewToggle } from './ui/viewToggle';
import { crossText, siliconText } from './content/silicon';
import type { SiliconMode } from './render/views';

function safeLocalStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function showFallback(host: HTMLElement): void {
  const box = document.createElement('div');
  box.className = 'fallback';
  const inner = document.createElement('div');
  const h = document.createElement('h2');
  h.textContent = noWebGL.title;
  const p = document.createElement('p');
  p.textContent = noWebGL.body;
  inner.append(h, p);
  box.append(inner);
  host.append(box);
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

/** What the chip world shows: the whole calculator or one lab bench. */
type Scene = { kind: 'chip'; chip: ChipView } | { kind: 'bench'; bench: Bench; text: BenchText };

function start(): void {
  const view = $('view');
  if (!hasWebGL2()) {
    showFallback(view);
    return;
  }

  const stage = new Stage(view);
  const mats = new WireMaterials();
  stage.onResize((w, h) => mats.setResolution(w, h));
  const nav = new Navigator(stage);
  /** The calculator itself: one machine for the whole page, whatever is on screen. */
  const machine = new Machine(library);
  let scene: Scene | null = null;
  /** The 3D device world is showing (instead of the chip world). */
  let onDevice = true;
  const device = new DeviceWorld();
  stage.onResize((w, h) => device.setSize(w, h));
  let busPanel: BusPanel | null = null;
  const host = () => (scene?.kind === 'chip' ? scene.chip : scene?.bench ?? null);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    mats.sparks = !reducedMotion.matches;
    nav.instant = reducedMotion.matches;
    device.instant = reducedMotion.matches;
    host()?.setFade(reducedMotion.matches ? 0 : FADE_SEC);
  };
  applyMotion();
  reducedMotion.addEventListener('change', applyMotion);

  // --- Speed and clock (DESIGN.md §6.5): one slider from slow motion to instant ---
  const slider = $<HTMLInputElement>('speed');
  const sliderValue = $('speed-value');
  $('speed-name').textContent = clockText.speed;
  $('speed-label').title = clockText.speedTitle;
  const clock = new ClockRunner();
  let msPerDelta = speedToMs(Number(slider.value));
  /** The slider is at its right end: no animation, results show at once. */
  let instant = false;
  const applySpeed = () => {
    const v = Number(slider.value);
    instant = isInstant(v);
    msPerDelta = speedToMs(v);
    clock.ticksPerSec = speedToRate(v);
    sliderValue.textContent = speedLabel(v);
    host()?.setSlowMotion(msPerDelta);
  };
  /** At Instant speed a running clock does all of the calculator's pending ticks at once. */
  const runsInstantly = () => instant && clock.mode === 'run';
  const step = () => host()?.tick();
  const clockBar = new ClockBar($('clock'), {
    onStep: step,
    onMode: (m) => clock.setMode(m),
  });
  applySpeed();

  // --- Keys: HUD, physical keyboard, chip-world key buttons ---
  /** A calculator key was pressed anywhere. */
  const pressKey = (code: number) => {
    if (onDevice) device.press(code);
    if (scene?.kind === 'chip') {
      scene.chip.press(code);
      if (runsInstantly()) scene.chip.runUntilIdle();
    } else {
      // Nothing to watch: the calculator works at once (DESIGN.md §11).
      machine.press(code);
      machine.runUntilIdle();
    }
  };
  const hud = new Hud(view, pressKey);
  /** Schematic | Silicon (DESIGN.md §6.2a): one mode for every view, kept while switching scenes. */
  const silicon: SiliconMode = { on: false };
  const viewToggle = new ViewToggle(view, silicon, () => refreshHover());

  // --- Panel and scenes ---
  const fitBtn = document.createElement('button');
  fitBtn.type = 'button';
  fitBtn.className = 'fit-btn';
  fitBtn.textContent = exploreText.fitView;
  fitBtn.title = exploreText.fitViewTitle;
  fitBtn.addEventListener('click', () => goHome());
  const breadcrumb = new Breadcrumb(view, fitBtn);
  const tooltip = new Tooltip(view);
  const stats = $('stats');
  const countCache = new Map<string, number>();
  const count = (def: ComponentDef) => transistorCount(def, library, countCache);
  $('stats-total').textContent = calculatorPanel.totalTransistors(count(library.get('Calculator')));
  $('stats-note').textContent = calculatorPanel.transistorNote;
  let speedTouched = false;
  slider.addEventListener('input', () => (speedTouched = true), { once: true });
  const explore = $<HTMLSelectElement>('explore');

  /** `title` is the bench's lesson title; the calculator scenes need none (the menu names them). */
  const setPanel = (title: string | null, steps: string[], help: string, current: string) => {
    $('bench-title').textContent = title ?? '';
    $('bench-title').hidden = !title;
    $('bench-steps').replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
    $('bench-help').textContent = help;
    explore.value = current;
  };
  const clearScene = () => {
    if (!scene) return;
    const h = host()!;
    stage.scene.remove(h.object);
    h.dispose();
    scene = null;
    tooltip.hide();
  };
  /** Device-world overlay: a prompt and the Look inside / Into the chip buttons. */
  const deviceUi = document.createElement('div');
  deviceUi.className = 'device-ui';
  const prompt = document.createElement('div');
  prompt.className = 'device-prompt';
  const deviceButtons = document.createElement('div');
  deviceButtons.className = 'device-buttons';
  const coverBtn = document.createElement('button');
  coverBtn.type = 'button';
  const chipBtn = document.createElement('button');
  chipBtn.type = 'button';
  chipBtn.className = 'primary';
  chipBtn.textContent = deviceText.intoChip;
  deviceButtons.append(coverBtn, chipBtn);
  deviceUi.append(prompt, deviceButtons);
  view.append(deviceUi);
  const fade = document.createElement('div');
  fade.className = 'fade';
  view.append(fade);
  const refreshDeviceUi = () => {
    const open = device.phase === 'open' || device.phase === 'opening';
    prompt.textContent = open ? deviceText.promptOpen : deviceText.prompt;
    coverBtn.textContent = open ? deviceText.closeCover : deviceText.lookInside;
    coverBtn.classList.toggle('primary', !open);
    chipBtn.hidden = !open;
  };
  coverBtn.addEventListener('click', () => {
    const open = device.phase === 'open' || device.phase === 'opening';
    device.setOpen(!open);
    refreshDeviceUi();
  });
  chipBtn.addEventListener('click', () => device.diveIn());
  const setDevice = (on: boolean) => {
    onDevice = on;
    nav.enabled = !on;
    deviceUi.hidden = !on;
    hud.visible = !on;
    tooltip.hide();
    if (on) {
      clearScene();
      $('bus-panel').hidden = true;
      stats.hidden = true;
      setPanel(null, devicePanel.steps, devicePanel.help, 'Device');
      refreshCrossBtn();
      refreshDeviceUi();
    }
  };
  const showDevice = (open = false) => {
    device.reset(open);
    setDevice(true);
  };
  device.onDived = () => {
    // Hand over to the chip world: fade through dark and pull back from the middle of the chip.
    fade.classList.add('on');
    window.setTimeout(() => {
      showCalculator();
      const home = scene?.kind === 'chip' ? scene.chip.homeView(aspect()) : null;
      if (home) {
        nav.flyTo({ ...home, height: home.height * 0.12 }, 0);
        nav.flyTo(home, 1.4);
      }
      fade.classList.remove('on');
    }, reducedMotion.matches ? 0 : 360);
  };
  const showCalculator = () => {
    setDevice(false);
    clearScene();
    const chip = new ChipView(machine, library, mats, silicon);
    scene = { kind: 'chip', chip };
    chip.onClockRise(() => clockBar.flash());
    if (!speedTouched) slider.value = String(CALCULATOR_SPEED);
    applySpeed();
    // The clock runs by itself; it stops on its own when the calculator waits for a key.
    clock.setMode('run');
    chip.setFade(reducedMotion.matches ? 0 : FADE_SEC);
    stage.scene.add(chip.object);
    nav.flyTo(chip.homeView(aspect()), 0);
    busPanel = null;
    $('bus-panel').hidden = true;
    stats.hidden = false;
    setPanel(null, calculatorPanel.steps, calculatorPanel.help, 'Calculator');
    refreshCrossBtn();
  };
  // Cross-section button (single-transistor benches only, DESIGN.md §6.2a).
  const crossBtn = document.createElement('button');
  crossBtn.type = 'button';
  crossBtn.className = 'cross-btn';
  crossBtn.title = crossText.buttonTitle;
  crossBtn.hidden = true;
  $('bench-steps').after(crossBtn);
  const refreshCrossBtn = () => {
    const bench = scene?.kind === 'bench' ? scene.bench : null;
    crossBtn.hidden = !bench?.hasCrossSection;
    crossBtn.textContent = bench?.crossSectionShown ? crossText.hide : crossText.show;
    crossBtn.setAttribute('aria-pressed', String(!!bench?.crossSectionShown));
  };
  crossBtn.addEventListener('click', () => {
    if (scene?.kind !== 'bench') return;
    scene.bench.setCrossSection(!scene.bench.crossSectionShown);
    refreshCrossBtn();
    nav.flyTo(scene.bench.homeView(aspect()));
  });
  const showBench = (b: BenchText) => {
    setDevice(false);
    clearScene();
    const bench = new Bench(library.get(b.component), library, mats, silicon);
    scene = { kind: 'bench', bench, text: b };
    bench.onClockRise(() => clockBar.flash());
    bench.setSlowMotion(msPerDelta);
    // A bench has no control unit to stop a running clock, so it starts paused: Step or Run.
    clock.setMode('pause');
    bench.setFade(reducedMotion.matches ? 0 : FADE_SEC);
    busPanel = new BusPanel($('bus-panel'), bench, b);
    stage.scene.add(bench.object);
    nav.flyTo(bench.homeView(aspect()), 0);
    stats.hidden = true;
    setPanel(b.title, b.steps, benchIntro.help, b.component);
    refreshCrossBtn();
  };
  // Explore menu (DESIGN.md §2): one grouped list instead of a button per scene.
  $('explore-label').textContent = exploreText.label;
  explore.title = exploreText.title;
  $('slowmo-note').textContent = slowMotionNote;
  const scenes = new Map<string, () => void>([
    ['Device', () => showDevice()],
    ['Calculator', showCalculator],
  ]);
  const optGroup = (label: string) => {
    const g = document.createElement('optgroup');
    g.label = label;
    explore.append(g);
    return g;
  };
  const option = (g: HTMLOptGroupElement, value: string, text: string) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    g.append(o);
  };
  const calcGroup = optGroup(exploreText.calculatorGroup);
  option(calcGroup, 'Device', deviceText.button);
  option(calcGroup, 'Calculator', calculatorPanel.button);
  const groups = new Map<BenchGroup, HTMLOptGroupElement>();
  for (const b of benches) {
    if (!groups.has(b.group)) groups.set(b.group, optGroup(b.group));
    option(groups.get(b.group)!, b.component, b.label);
    scenes.set(b.component, () => showBench(b));
  }
  explore.addEventListener('change', () => {
    scenes.get(explore.value)?.();
    // Give the keyboard back to the calculator and bench letters (no type-ahead in the menu).
    explore.blur();
  });
  slider.addEventListener('input', applySpeed);

  // --- Zoom navigation: fly-to, breadcrumb, Backspace / Home (DESIGN.md §6.3) ---
  function aspect() {
    return stage.width / stage.height;
  }
  const goHome = () => {
    const h = host();
    if (h) nav.flyTo(h.homeView(aspect()));
  };
  const flyToView = (v: ComponentView) => {
    // A little extra room at the top keeps the frame's title clear of the breadcrumb.
    const [l, b, r, t] = v.worldBounds;
    nav.flyTo(fitView([l, b, r, t + (t - b) * 0.08] as Bounds, aspect()));
  };
  /** Opened instances from the scene's component down to the one at the centre of the screen. */
  const focusChain = () => host()?.view.focusChain(stage.view.cx, stage.view.cy) ?? [];
  const zoomOut = () => {
    const chain = focusChain().filter((v) => v.isExpanded);
    if (chain.length >= 2) flyToView(chain[chain.length - 2]);
    else goHome();
  };
  const updateBreadcrumb = () => {
    fitBtn.hidden = onDevice;
    if (onDevice) {
      const open = device.phase !== 'closed';
      viewToggle.visible = false;
      breadcrumb.set([
        { text: deviceText.crumbDevice, onClick: () => device.setOpen(false) },
        ...(open ? [{ text: deviceText.crumbBoard }] : []),
      ]);
      return;
    }
    if (!scene) return;
    // Only the zoom path inside the scene: the Explore menu already says which scene this is.
    const chain = focusChain();
    const crumbs: Crumb[] = chain.map((v, i) => ({ text: v.displayName, onClick: i === 0 ? goHome : () => flyToView(v) }));
    const last = chain.at(-1);
    if (last?.isTransistorView) crumbs.push({ text: last.isSiliconView ? siliconText.crumb : tooltipText.transistors });
    breadcrumb.set(crumbs);
    // Only where it changes something: an opened gate on screen (closed gate boxes keep symbols).
    viewToggle.visible = !!host()?.view.showsTransistorsIn(stage.visibleRect);
  };

  // --- Pointer: click switches/keys, hover tooltips, double-click to fly ---
  const HOVER_TOL_PX = 6;
  let hover: { px: number; py: number } | null = null;
  const refreshHover = () => {
    const h = host();
    if (!h || !hover) return;
    const [x, y] = stage.toWorld(hover.px, hover.py);
    const hit = h.hit(x, y, HOVER_TOL_PX / stage.pxPerWorld);
    const clickable = hit?.kind === 'switch' || hit?.kind === 'key' || hit?.kind === 'clock';
    stage.renderer.domElement.style.cursor = clickable ? 'pointer' : '';
    if (hit) tooltip.show(describe(hit, h), hover.px, hover.py);
    else tooltip.hide();
  };
  nav.onClick = (x, y) => {
    const h = host();
    if (h?.click(x, y) && scene?.kind === 'chip' && runsInstantly()) scene.chip.runUntilIdle();
    refreshHover();
  };
  nav.onHover = (_x, _y, px, py) => {
    hover = { px, py };
    refreshHover();
  };
  nav.onLeave = () => {
    hover = null;
    tooltip.hide();
  };
  nav.onDoubleClick = (x, y) => {
    const h = host();
    if (!h) return;
    const hit = h.hit(x, y, HOVER_TOL_PX / stage.pxPerWorld);
    if (hit?.kind === 'switch' || hit?.kind === 'key' || hit?.kind === 'clock') return;
    if (hit && 'view' in hit) flyToView(hit.view);
    else if (!hit) goHome();
  };
  // --- Pointer in the device world: keys, hover over board parts, scroll to look inside ---
  const canvas = stage.renderer.domElement;
  const local = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  canvas.addEventListener('pointermove', (e) => {
    if (!onDevice) return;
    const [px, py] = local(e);
    const hit = device.pick(px, py, stage.width, stage.height);
    canvas.style.cursor = hit?.kind === 'key' ? 'pointer' : '';
    if (!hit) tooltip.hide();
    else if (hit.kind === 'key') {
      tooltip.show({ title: calculatorTips.keyTitle(KEY_LABELS[hit.code]), body: propText.key.body, values: [] }, px, py);
    } else {
      const t = propText[hit.id];
      tooltip.show({ title: t.title, body: t.body, values: [] }, px, py);
    }
  });
  canvas.addEventListener('pointerleave', () => onDevice && tooltip.hide());
  canvas.addEventListener('click', (e) => {
    if (!onDevice) return;
    const [px, py] = local(e);
    const hit = device.pick(px, py, stage.width, stage.height);
    if (hit?.kind === 'key') pressKey(hit.code);
    else if (hit?.kind === 'prop' && hit.id === 'chip') device.diveIn();
  });
  canvas.addEventListener('wheel', (e) => {
    if (!onDevice) return;
    e.preventDefault();
    if (Math.abs(e.deltaY) < 4 || device.phase === 'diving') return;
    if (e.deltaY < 0) {
      // Scrolling in: first the cover comes off, then we dive into the chip.
      if (device.phase === 'open') device.diveIn();
      else if (device.phase !== 'opening') device.setOpen(true);
    } else if (device.phase === 'open' || device.phase === 'opening') device.setOpen(false);
    refreshDeviceUi();
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    if (onDevice && e.key === 'Backspace') {
      e.preventDefault();
      device.setOpen(false);
      refreshDeviceUi();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      goHome();
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      zoomOut();
      return;
    }
    if (e.key === ' ') {
      // Space = Step everywhere outside text fields, even when a button has focus (students
      // click a preset, then press Space). Enter still presses a focused button.
      e.preventDefault();
      step();
      return;
    }
    // A bench's own input letters come first (e.g. R of the SR latch); otherwise the calculator.
    const pin = e.key.toLowerCase();
    if (scene?.kind === 'bench' && pin.length === 1 && scene.bench.inputs.includes(pin)) {
      e.preventDefault();
      scene.bench.toggle(pin);
      return;
    }
    if (e.key === 'Enter' && e.target instanceof HTMLButtonElement) return;
    const code = keyCodeFor(e.key);
    if (code !== null) {
      e.preventDefault();
      pressKey(code);
    }
  });

  // --- Quality ---
  const qualityBtn = $<HTMLButtonElement>('quality-btn');
  const store = safeLocalStorage();
  let setting: QualitySetting = loadQualitySetting(store);
  let probe: QualityProbe | null = setting === 'auto' ? new QualityProbe() : null;
  let autoResult: Quality | null = null;
  const applyQuality = (q: Quality) => {
    stage.setQuality(q);
    mats.setQuality(q);
    host()?.refreshAll();
    const label = setting === 'auto' ? `auto (${autoResult ?? 'measuring…'})` : setting;
    qualityBtn.textContent = `⚙ quality: ${label}`;
  };
  applyQuality(setting === 'low' ? 'low' : 'high');
  qualityBtn.addEventListener('click', () => {
    setting = nextQualitySetting(setting);
    saveQualitySetting(store, setting);
    if (setting === 'auto') {
      autoResult = null;
      probe = new QualityProbe();
      applyQuality('high');
    } else {
      probe = null;
      applyQuality(setting);
    }
  });

  showDevice();

  // --- Frame loop ---
  const fpsEl = $('fps');
  const statsView = $('stats-view');
  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let hoverClock = 0;
  let statsClock = 0;
  const frame = (now: number) => {
    const dtMs = Math.min(now - last, 250);
    last = now;
    if (probe) {
      const decision = probe.addFrame(dtMs);
      if (decision) {
        autoResult = decision;
        probe = null;
        applyQuality(decision);
      }
    }
    nav.update(dtMs / 1000);
    const h = host();
    const chip = scene?.kind === 'chip' ? scene.chip : null;
    if (h) {
      if (chip && instant && machine.busy) {
        if (runsInstantly()) chip.runUntilIdle();
      } else if (clock.update(dtMs, h.playback.busy, chip ? machine.busy : undefined)) h.tick();
    }
    clockBar.update({ enabled: !!h?.hasClock, mode: clock.mode, ticks: h?.ticks ?? 0, high: h?.clockValue === 1 });
    mats.worldPerPx = 1 / stage.pxPerWorld;
    h?.update(dtMs, { ...stage.visibleRect, pxPerWorld: stage.pxPerWorld });
    busPanel?.update();
    if (onDevice) {
      device.update(dtMs / 1000, (p) => machine.sim.output(p) === 1, machine.mIndicator === 1);
      if (device.phase === 'open' || device.phase === 'closed') refreshDeviceUi();
    }
    hud.update({
      segment: (p) => (chip ? chip.outputValue(p) : machine.sim.output(p)) === 1,
      mLamp: (chip ? chip.outputValue('mInd') : machine.mIndicator) === 1,
      held: machine.held,
      queue: machine.queue,
    });
    updateBreadcrumb();
    hoverClock += dtMs;
    if (hoverClock > 120) {
      // Values and zoom change under a still pointer, so refresh the tooltip now and then.
      hoverClock = 0;
      refreshHover();
    }
    statsClock += dtMs;
    if (chip && statsClock > 250) {
      statsClock = 0;
      statsView.textContent = calculatorPanel.viewTransistors(chip.view.transistorsInView(stage.visibleRect, count));
    }
    if (onDevice) device.render(stage.renderer);
    else stage.render(dtMs / 1000);

    fpsAccum += dtMs;
    fpsFrames++;
    if (fpsAccum >= 500) {
      fpsEl.textContent = `${Math.round((fpsFrames * 1000) / fpsAccum)} fps`;
      fpsAccum = 0;
      fpsFrames = 0;
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  if (import.meta.env.DEV) {
    // Dev-only handle for visual checks (Playwright); removed from production builds.
    (window as unknown as Record<string, unknown>).__calc = {
      stage, nav, clock, machine, pressKey, showCalculator, showDevice, device, silicon, viewToggle,
      get bench() { return scene?.kind === 'bench' ? scene.bench : null; },
      get chip() { return scene?.kind === 'chip' ? scene.chip : null; },
      showBench: (name: string) => showBench(benches.find((b) => b.component === name)!),
    };
  }
}

start();

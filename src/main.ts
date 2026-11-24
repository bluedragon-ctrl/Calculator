import './style.css';
import { library } from './circuits/library';
import { keyCodeFor, Machine } from './circuits/machine';
import { benches, benchIntro, slowMotionNote, type BenchText } from './content/bench';
import { calculatorPanel } from './content/calculator';
import { noWebGL } from './content/messages';
import { tooltipText } from './content/tooltips';
import { Bench } from './render/bench';
import { ChipView } from './render/chip';
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
import { msLabel, sliderToMs } from './ui/slowmo';
import { ClockRunner } from './ui/clock';
import { ClockBar } from './ui/clockBar';

/** Slow-motion slider position used when the calculator is first shown (about 30 ms per step). */
const CALCULATOR_SLOWMO = 12;

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
  let busPanel: BusPanel | null = null;
  const host = () => (scene?.kind === 'chip' ? scene.chip : scene?.bench ?? null);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    mats.sparks = !reducedMotion.matches;
    nav.instant = reducedMotion.matches;
    host()?.setFade(reducedMotion.matches ? 0 : FADE_SEC);
  };
  applyMotion();
  reducedMotion.addEventListener('change', applyMotion);

  // --- Slow motion and clock (DESIGN.md §6.5) ---
  const slider = $<HTMLInputElement>('slowmo');
  const sliderValue = $('slowmo-value');
  const clock = new ClockRunner();
  let msPerDelta = sliderToMs(Number(slider.value));
  const applySlowmo = () => {
    // Instant mode skips the animation whatever the slider says.
    const instant = clock.mode === 'instant';
    msPerDelta = instant ? 0 : sliderToMs(Number(slider.value));
    slider.disabled = instant;
    sliderValue.textContent = msLabel(msPerDelta);
    host()?.setSlowMotion(msPerDelta);
  };
  const step = () => host()?.tick();
  const clockBar = new ClockBar($('clock'), {
    onStep: step,
    onMode: (m) => {
      clock.setMode(m);
      applySlowmo();
    },
    onRate: (r) => (clock.ticksPerSec = r),
  });

  // --- Keys: HUD, physical keyboard, chip-world key buttons ---
  /** A calculator key was pressed anywhere. */
  const pressKey = (code: number) => {
    if (scene?.kind === 'chip') {
      scene.chip.press(code);
      if (clock.mode === 'instant') scene.chip.runUntilIdle();
    } else {
      // Nothing to watch: the calculator works at once (DESIGN.md §11).
      machine.press(code);
      machine.runUntilIdle();
    }
  };
  const hud = new Hud(view, pressKey);

  // --- Panel and scenes ---
  const buttons = $('bench-buttons');
  const breadcrumb = new Breadcrumb(view);
  const tooltip = new Tooltip(view);
  const stats = $('stats');
  const countCache = new Map<string, number>();
  const count = (def: ComponentDef) => transistorCount(def, library, countCache);
  $('stats-total').textContent = calculatorPanel.totalTransistors(count(library.get('Calculator')));
  $('stats-note').textContent = calculatorPanel.transistorNote;
  let slowmoTouched = false;
  slider.addEventListener('input', () => (slowmoTouched = true), { once: true });

  const setPanel = (title: string, steps: string[], help: string, pressed: string) => {
    $('bench-title').textContent = title;
    $('bench-steps').replaceChildren(...steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
    $('bench-help').textContent = help;
    for (const btn of buttons.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.component === pressed));
    }
  };
  const clearScene = () => {
    if (!scene) return;
    const h = host()!;
    stage.scene.remove(h.object);
    h.dispose();
    scene = null;
    tooltip.hide();
  };
  const showCalculator = () => {
    clearScene();
    const chip = new ChipView(machine, library, mats);
    scene = { kind: 'chip', chip };
    chip.onClockRise(() => clockBar.flash());
    if (!slowmoTouched) slider.value = String(CALCULATOR_SLOWMO);
    applySlowmo();
    chip.setFade(reducedMotion.matches ? 0 : FADE_SEC);
    stage.scene.add(chip.object);
    nav.flyTo(chip.homeView(aspect()), 0);
    busPanel = null;
    $('bus-panel').hidden = true;
    stats.hidden = false;
    setPanel(calculatorPanel.title, calculatorPanel.steps, calculatorPanel.help, 'Calculator');
  };
  const showBench = (b: BenchText) => {
    clearScene();
    const bench = new Bench(library.get(b.component), library, mats);
    scene = { kind: 'bench', bench, text: b };
    bench.onClockRise(() => clockBar.flash());
    bench.setSlowMotion(msPerDelta);
    bench.setFade(reducedMotion.matches ? 0 : FADE_SEC);
    busPanel = new BusPanel($('bus-panel'), bench, b);
    stage.scene.add(bench.object);
    nav.flyTo(bench.homeView(aspect()), 0);
    stats.hidden = true;
    setPanel(b.title, b.steps, benchIntro.help, b.component);
  };
  $('panel-heading').textContent = calculatorPanel.benchHeading;
  $('slowmo-note').textContent = slowMotionNote;
  {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'calc';
    btn.textContent = calculatorPanel.button;
    btn.dataset.component = 'Calculator';
    btn.addEventListener('click', showCalculator);
    buttons.append(btn);
  }
  for (const b of benches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    btn.dataset.component = b.component;
    btn.addEventListener('click', () => showBench(b));
    buttons.append(btn);
  }
  slider.addEventListener('input', applySlowmo);

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
    if (!scene) return;
    const crumbs: Crumb[] = [{ text: scene.kind === 'chip' ? 'Calculator' : 'Lab bench', onClick: goHome }];
    const chain = focusChain();
    for (const v of chain) crumbs.push({ text: v.displayName, onClick: () => flyToView(v) });
    if (chain.at(-1)?.isTransistorView) crumbs.push({ text: tooltipText.transistors });
    breadcrumb.set(crumbs);
  };
  $('home-btn').addEventListener('click', goHome);

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
    if (h?.click(x, y) && scene?.kind === 'chip' && clock.mode === 'instant') scene.chip.runUntilIdle();
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
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
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

  showCalculator();

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
      if (chip && clock.mode === 'instant' && machine.busy) chip.runUntilIdle();
      else if (clock.update(dtMs, h.playback.busy, !!chip && machine.busy)) h.tick();
    }
    clockBar.update({ enabled: !!h?.hasClock, mode: clock.mode, ticks: h?.ticks ?? 0, high: h?.clockValue === 1 });
    mats.worldPerPx = 1 / stage.pxPerWorld;
    h?.update(dtMs, { ...stage.visibleRect, pxPerWorld: stage.pxPerWorld });
    busPanel?.update();
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
    stage.render(dtMs / 1000);

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
      stage, nav, clock, machine, pressKey, showCalculator,
      get bench() { return scene?.kind === 'bench' ? scene.bench : null; },
      get chip() { return scene?.kind === 'chip' ? scene.chip : null; },
      showBench: (name: string) => showBench(benches.find((b) => b.component === name)!),
    };
  }
}

start();

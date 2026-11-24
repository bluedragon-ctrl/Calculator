import './style.css';
import { library } from './circuits/library';
import { benches, benchIntro, slowMotionNote, type BenchText } from './content/bench';
import { noWebGL } from './content/messages';
import { tooltipText } from './content/tooltips';
import { Bench } from './render/bench';
import { FADE_SEC, fitView, type Bounds } from './render/lod';
import { Stage, hasWebGL2 } from './render/stage';
import type { ComponentView } from './render/views';
import { WireMaterials } from './render/wires';
import { Breadcrumb, type Crumb } from './ui/breadcrumb';
import { BusPanel } from './ui/busPanel';
import { describe } from './ui/describe';
import { Navigator } from './ui/navigation';
import { Tooltip } from './ui/tooltip';
import {
  QualityProbe, loadQualitySetting, nextQualitySetting, saveQualitySetting,
  type Quality, type QualitySetting,
} from './ui/quality';
import { msLabel, sliderToMs } from './ui/slowmo';
import { ClockRunner } from './ui/clock';
import { ClockBar } from './ui/clockBar';

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
  let bench: Bench | null = null;
  let busPanel: BusPanel | null = null;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    mats.sparks = !reducedMotion.matches;
    nav.instant = reducedMotion.matches;
    bench?.setFade(reducedMotion.matches ? 0 : FADE_SEC);
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
    bench?.setSlowMotion(msPerDelta);
  };
  const step = () => bench?.tick();
  const clockBar = new ClockBar($('clock'), {
    onStep: step,
    onMode: (m) => {
      clock.setMode(m);
      applySlowmo();
    },
    onRate: (r) => (clock.ticksPerSec = r),
  });

  // --- Bench ---
  const buttons = $('bench-buttons');
  const breadcrumb = new Breadcrumb(view);
  const tooltip = new Tooltip(view);
  const showBench = (b: BenchText) => {
    if (bench) {
      stage.scene.remove(bench.object);
      bench.dispose();
    }
    tooltip.hide();
    bench = new Bench(library.get(b.component), library, mats);
    bench.onClockRise(() => clockBar.flash());
    bench.setSlowMotion(msPerDelta);
    bench.setFade(reducedMotion.matches ? 0 : FADE_SEC);
    busPanel = new BusPanel($('bus-panel'), bench, b);
    stage.scene.add(bench.object);
    nav.flyTo(bench.homeView(stage.width / stage.height), 0);
    $('bench-title').textContent = b.title;
    const steps = $('bench-steps');
    steps.replaceChildren(...b.steps.map((s) => {
      const li = document.createElement('li');
      li.textContent = s;
      return li;
    }));
    for (const btn of buttons.querySelectorAll('button')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.component === b.component));
    }
  };
  $('panel-heading').textContent = benchIntro.heading;
  $('bench-help').textContent = benchIntro.help;
  $('slowmo-note').textContent = slowMotionNote;
  for (const b of benches) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = b.label;
    btn.dataset.component = b.component;
    btn.addEventListener('click', () => showBench(b));
    buttons.append(btn);
  }
  showBench(benches[0]);
  slider.addEventListener('input', applySlowmo);
  applySlowmo();

  // --- Zoom navigation: fly-to, breadcrumb, Backspace / Home (DESIGN.md §6.3) ---
  const aspect = () => stage.width / stage.height;
  const goHome = () => bench && nav.flyTo(bench.homeView(aspect()));
  const flyToView = (v: ComponentView) => {
    // A little extra room at the top keeps the frame's title clear of the breadcrumb.
    const [l, b, r, t] = v.worldBounds;
    nav.flyTo(fitView([l, b, r, t + (t - b) * 0.08] as Bounds, aspect()));
  };
  /** Opened instances from the bench's component down to the one at the centre of the screen. */
  const focusChain = () => bench?.view.focusChain(stage.view.cx, stage.view.cy) ?? [];
  const zoomOut = () => {
    const chain = focusChain().filter((v) => v.isExpanded);
    if (chain.length >= 2) flyToView(chain[chain.length - 2]);
    else goHome();
  };
  const updateBreadcrumb = () => {
    if (!bench) return;
    const crumbs: Crumb[] = [{ text: 'Lab bench', onClick: goHome }];
    const chain = focusChain();
    for (const v of chain) crumbs.push({ text: v.displayName, onClick: () => flyToView(v) });
    if (chain.at(-1)?.isTransistorView) crumbs.push({ text: tooltipText.transistors });
    breadcrumb.set(crumbs);
  };
  $('home-btn').addEventListener('click', goHome);

  // --- Pointer: click switches, hover tooltips, double-click to fly ---
  const HOVER_TOL_PX = 6;
  let hover: { px: number; py: number } | null = null;
  const refreshHover = () => {
    if (!bench || !hover) return;
    const [x, y] = stage.toWorld(hover.px, hover.py);
    const hit = bench.hit(x, y, HOVER_TOL_PX / stage.pxPerWorld);
    stage.renderer.domElement.style.cursor = hit?.kind === 'switch' ? 'pointer' : '';
    if (hit) tooltip.show(describe(hit, bench), hover.px, hover.py);
    else tooltip.hide();
  };
  nav.onClick = (x, y) => {
    const pin = bench?.switchAt(x, y);
    if (pin) bench!.toggle(pin);
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
    if (!bench || bench.switchAt(x, y)) return;
    const hit = bench.hit(x, y, HOVER_TOL_PX / stage.pxPerWorld);
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
    const pin = e.key.toLowerCase();
    if (bench && pin.length === 1 && bench.inputs.includes(pin)) bench.toggle(pin);
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
    bench?.refresh();
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

  // --- Frame loop ---
  const fpsEl = $('fps');
  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  let hoverClock = 0;
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
    if (bench && clock.update(dtMs, bench.playback.busy)) bench.tick();
    clockBar.update({
      enabled: !!bench?.hasClock, mode: clock.mode, ticks: bench?.ticks ?? 0, high: bench?.clockValue === 1,
    });
    mats.worldPerPx = 1 / stage.pxPerWorld;
    bench?.update(dtMs, { ...stage.visibleRect, pxPerWorld: stage.pxPerWorld });
    busPanel?.update();
    updateBreadcrumb();
    hoverClock += dtMs;
    if (hoverClock > 120) {
      // Values and zoom change under a still pointer, so refresh the tooltip now and then.
      hoverClock = 0;
      refreshHover();
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
      stage, nav, clock, get bench() { return bench; }, showBench: (name: string) => showBench(benches.find((b) => b.component === name)!),
    };
  }
}

start();

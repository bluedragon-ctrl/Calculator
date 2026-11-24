import './style.css';
import { library } from './circuits/library';
import { benches, benchIntro, slowMotionNote, type BenchText } from './content/bench';
import { noWebGL } from './content/messages';
import { Bench } from './render/bench';
import { Stage, hasWebGL2 } from './render/stage';
import { WireMaterials } from './render/wires';
import { Navigator } from './ui/navigation';
import {
  QualityProbe, loadQualitySetting, nextQualitySetting, saveQualitySetting,
  type Quality, type QualitySetting,
} from './ui/quality';
import { msLabel, sliderToMs } from './ui/slowmo';

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

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => {
    mats.sparks = !reducedMotion.matches;
    nav.instant = reducedMotion.matches;
  };
  applyMotion();
  reducedMotion.addEventListener('change', applyMotion);

  // --- Slow motion ---
  const slider = $<HTMLInputElement>('slowmo');
  const sliderValue = $('slowmo-value');
  let msPerDelta = sliderToMs(Number(slider.value));
  const applySlowmo = () => {
    msPerDelta = sliderToMs(Number(slider.value));
    sliderValue.textContent = msLabel(msPerDelta);
    bench?.setSlowMotion(msPerDelta);
  };

  // --- Bench ---
  let bench: Bench | null = null;
  const buttons = $('bench-buttons');
  const showBench = (b: BenchText) => {
    if (bench) {
      stage.scene.remove(bench.object);
      bench.dispose();
    }
    bench = new Bench(library.get(b.component), library, mats);
    bench.setSlowMotion(msPerDelta);
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

  // --- Input ---
  const goHome = () => bench && nav.flyTo(bench.homeView(stage.width / stage.height));
  $('home-btn').addEventListener('click', goHome);
  nav.onClick = (x, y) => {
    const pin = bench?.switchAt(x, y);
    if (pin) bench!.toggle(pin);
  };
  nav.onHover = (x, y) => {
    stage.renderer.domElement.style.cursor = bench?.switchAt(x, y) ? 'pointer' : '';
  };
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'Home') {
      e.preventDefault();
      goHome();
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
    mats.worldPerPx = 1 / stage.pxPerWorld;
    bench?.update(dtMs, { ...stage.visibleRect, pxPerWorld: stage.pxPerWorld });
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
}

start();

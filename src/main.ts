import './style.css';
import { noWebGL } from './content/messages';
import { Stage, hasWebGL2 } from './render/stage';
import { TestPattern } from './render/testScene';
import { WireMaterials } from './render/wires';
import {
  QualityProbe, loadQualitySetting, nextQualitySetting, saveQualitySetting,
  type Quality, type QualitySetting,
} from './ui/quality';

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

function start(): void {
  const view = document.getElementById('view')!;
  const fpsEl = document.getElementById('fps')!;
  const qualityBtn = document.getElementById('quality-btn') as HTMLButtonElement;

  if (!hasWebGL2()) {
    showFallback(view);
    return;
  }

  const stage = new Stage(view);
  const materials = new WireMaterials();
  stage.onResize((w, h) => materials.setResolution(w, h));
  const pattern = new TestPattern(materials);
  stage.scene.add(pattern.object);

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const applyMotion = () => (pattern.sparks.enabled = !reducedMotion.matches);
  applyMotion();
  reducedMotion.addEventListener('change', applyMotion);

  const store = safeLocalStorage();
  let setting: QualitySetting = loadQualitySetting(store);
  let probe: QualityProbe | null = setting === 'auto' ? new QualityProbe() : null;
  let autoResult: Quality | null = null;

  const applyQuality = (q: Quality) => {
    stage.setQuality(q);
    materials.setQuality(q);
    pattern.sparks.setQuality(q);
    pattern.refreshAll();
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

  let last = performance.now();
  let fpsAccum = 0;
  let fpsFrames = 0;
  const frame = (now: number) => {
    const dtMs = Math.min(now - last, 250);
    last = now;
    const dt = dtMs / 1000;

    if (probe) {
      const decision = probe.addFrame(dtMs);
      if (decision) {
        autoResult = decision;
        probe = null;
        applyQuality(decision);
      }
    }

    pattern.update(dt);
    stage.render(dt);

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

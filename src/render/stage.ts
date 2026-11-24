// Chip-world stage: renderer, orthographic top-down camera, optional bloom.
import {
  BufferGeometry, Float32BufferAttribute, HalfFloatType, LineBasicMaterial, LineSegments,
  NoToneMapping, OrthographicCamera, Scene, WebGLRenderer,
} from 'three';
import { BloomEffect, EffectComposer, EffectPass, RenderPass } from 'postprocessing';
import type { Quality } from '../ui/quality';
import { BACKGROUND, BLOOM_THRESHOLD, GRID } from './palette';

/** World units visible vertically at zoom 1. */
const VIEW_HEIGHT = 24;

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

export class Stage {
  readonly scene = new Scene();
  readonly camera = new OrthographicCamera(-1, 1, 1, -1, -100, 100);
  readonly renderer: WebGLRenderer;
  private composer: EffectComposer | null = null;
  private quality: Quality = 'high';
  private readonly resizeObserver: ResizeObserver;
  private readonly resizeListeners: ((w: number, h: number) => void)[] = [];

  constructor(private readonly host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(BACKGROUND, 1);
    host.appendChild(this.renderer.domElement);
    this.scene.background = BACKGROUND;
    this.camera.position.set(0, 0, 10);
    this.scene.add(makeGrid(200, 1));
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  onResize(fn: (w: number, h: number) => void): void {
    this.resizeListeners.push(fn);
    fn(this.host.clientWidth, this.host.clientHeight);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    if (q === 'high' && !this.composer) {
      const composer = new EffectComposer(this.renderer, { frameBufferType: HalfFloatType, multisampling: 4 });
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new EffectPass(this.camera, new BloomEffect({
        luminanceThreshold: BLOOM_THRESHOLD,
        luminanceSmoothing: 0.3,
        intensity: 0.75,
        mipmapBlur: true,
        radius: 0.45,
      })));
      this.composer = composer;
      this.resize();
    } else if (q === 'low' && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
  }

  get currentQuality(): Quality {
    return this.quality;
  }

  render(dtSec: number): void {
    if (this.composer) this.composer.render(dtSec);
    else this.renderer.render(this.scene, this.camera);
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
    const aspect = w / h;
    this.camera.top = VIEW_HEIGHT / 2;
    this.camera.bottom = -VIEW_HEIGHT / 2;
    this.camera.left = (-VIEW_HEIGHT * aspect) / 2;
    this.camera.right = (VIEW_HEIGHT * aspect) / 2;
    this.camera.updateProjectionMatrix();
    for (const fn of this.resizeListeners) fn(w, h);
  }
}

function makeGrid(size: number, step: number): LineSegments {
  const pos: number[] = [];
  const half = size / 2;
  for (let v = -half; v <= half; v += step) {
    pos.push(-half, v, -1, half, v, -1, v, -half, -1, v, half, -1);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return new LineSegments(g, new LineBasicMaterial({ color: GRID }));
}

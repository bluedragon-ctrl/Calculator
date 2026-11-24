// Mini-calculator HUD (DESIGN.md §2): mirrors the simulated display and has clickable keys.
// The display shows the values on the chip's segment wires, so it changes exactly when they do.
import { hudText as T } from '../content/calculator';
import { KEY_LABELS } from '../circuits/machine';
import { segmentRects, SEGMENTS } from '../render/segments';

const SVG = 'http://www.w3.org/2000/svg';

/** Key layout of the HUD (codes), like a pocket calculator. */
const LAYOUT = [
  [7, 8, 9, 13],
  [4, 5, 6, 14],
  [1, 2, 3, 15],
  [0, 10, 11, 12],
];

export interface HudState {
  /** Segment output pins (e.g. `ha`, `sg`) → lit. */
  segment(pin: string): boolean;
  mLamp: boolean;
  /** Key whose line is high right now (waiting for the clock edge). */
  held: number | null;
  queue: readonly number[];
}

export class Hud {
  readonly el = document.createElement('div');
  private readonly segs: { pin: string; el: SVGRectElement }[] = [];
  private readonly m = document.createElement('span');
  private readonly wait = document.createElement('div');
  private readonly keys = new Map<number, HTMLButtonElement>();
  private key = '';

  constructor(host: HTMLElement, onKey: (code: number) => void) {
    this.el.className = 'hud';
    this.el.setAttribute('role', 'group');
    this.el.setAttribute('aria-label', T.label);

    const display = document.createElement('div');
    display.className = 'hud-display';
    const svg = document.createElementNS(SVG, 'svg');
    const dw = 18;
    const dh = 30;
    const gap = 7;
    svg.setAttribute('viewBox', `-4 -4 ${4 * dw + 3 * gap + 8} ${dh + 8}`);
    svg.setAttribute('aria-hidden', 'true');
    const rects = segmentRects(dw, dh);
    ['sg', 'h', 't', 'o'].forEach((d, i) => {
      for (const s of SEGMENTS) {
        if (d === 'sg' && s !== 'g') continue;
        const [cx, cy, w, h] = rects[s];
        const r = document.createElementNS(SVG, 'rect');
        r.setAttribute('x', String(i * (dw + gap) + cx - w / 2));
        r.setAttribute('y', String(cy - h / 2));
        r.setAttribute('width', String(w));
        r.setAttribute('height', String(h));
        r.setAttribute('rx', String(Math.min(w, h) / 2));
        svg.append(r);
        this.segs.push({ pin: d === 'sg' ? 'sg' : `${d}${s}`, el: r });
      }
    });
    this.m.className = 'hud-m';
    this.m.textContent = 'M';
    this.m.title = T.mTitle;
    display.append(this.m, svg);

    const grid = document.createElement('div');
    grid.className = 'hud-keys';
    for (const row of LAYOUT) {
      for (const code of row) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = KEY_LABELS[code];
        b.dataset.code = String(code);
        if (code >= 10) b.classList.add('op');
        // Keep keyboard focus where it was, so Space and Enter keep their meaning.
        b.addEventListener('mousedown', (e) => e.preventDefault());
        b.addEventListener('click', () => onKey(code));
        grid.append(b);
        this.keys.set(code, b);
      }
    }
    this.wait.className = 'hud-wait';
    this.wait.title = T.waitingTitle;
    this.wait.hidden = true;
    this.el.append(display, grid, this.wait);
    host.append(this.el);
  }

  set visible(v: boolean) {
    this.el.hidden = !v;
  }

  update(s: HudState): void {
    const lit = this.segs.map((g) => (s.segment(g.pin) ? 1 : 0)).join('');
    const key = `${lit}|${s.mLamp}|${s.held}|${s.queue.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    this.segs.forEach((g, i) => g.el.classList.toggle('on', lit[i] === '1'));
    this.m.classList.toggle('on', s.mLamp);
    for (const [code, b] of this.keys) b.classList.toggle('held', code === s.held);
    this.wait.hidden = s.queue.length === 0;
    this.wait.textContent = `${T.waiting} ${s.queue.map((c) => KEY_LABELS[c]).join(' ')}`;
  }
}

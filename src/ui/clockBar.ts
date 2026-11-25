// Clock controls in the bottom bar (DESIGN.md §2, §6.5): Pause, Step, Run, a tick counter and
// a light that pulses on every tick. The speed slider next to them is wired up in main.ts.
import { clockText as T } from '../content/messages';
import type { ClockMode } from './clock';

export interface ClockBarHandlers {
  onStep(): void;
  onMode(mode: ClockMode): void;
}

export interface ClockBarState {
  /** False when the current component has no clock. */
  enabled: boolean;
  mode: ClockMode;
  ticks: number;
  /** Displayed value of the clock wire. */
  high: boolean;
}

export class ClockBar {
  private readonly pulse = document.createElement('span');
  private readonly modes = new Map<ClockMode, HTMLButtonElement>();
  private readonly step: HTMLButtonElement;
  private readonly counter = document.createElement('span');
  private key = '';

  constructor(private readonly host: HTMLElement, h: ClockBarHandlers) {
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', T.group);
    this.pulse.className = 'clock-pulse';
    this.pulse.title = T.pulseTitle;
    this.pulse.setAttribute('role', 'img');
    this.pulse.setAttribute('aria-label', T.group);

    const button = (text: string, title: string, onClick: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', onClick);
      return b;
    };
    const pause = button(T.pause, T.pauseTitle, () => h.onMode('pause'));
    this.step = button(T.step, T.stepTitle, () => h.onStep());
    const run = button(T.run, T.runTitle, () => h.onMode('run'));
    this.modes.set('pause', pause).set('run', run);

    this.counter.className = 'clock-ticks';
    host.append(this.pulse, pause, this.step, run, this.counter);
  }

  /** Flash the light (called when the displayed clock rises, so it also shows instant ticks). */
  flash(): void {
    this.pulse.classList.remove('flash');
    void this.pulse.offsetWidth; // restart the CSS animation
    this.pulse.classList.add('flash');
  }

  update(s: ClockBarState): void {
    this.pulse.classList.toggle('high', s.high);
    const key = `${s.enabled}|${s.mode}|${s.ticks}`;
    if (key === this.key) return;
    this.key = key;
    for (const [m, b] of this.modes) {
      b.setAttribute('aria-pressed', String(m === s.mode));
      b.disabled = !s.enabled;
    }
    this.step.disabled = !s.enabled;
    this.counter.textContent = s.enabled ? T.ticks(s.ticks) : '';
    this.host.title = s.enabled ? '' : T.noClock;
  }
}

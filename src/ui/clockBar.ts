// Clock controls in the bottom bar (DESIGN.md §2, §6.5): Pause, Step, Play with a speed
// slider, Instant, a tick counter and a light that pulses on every tick.
import { clockText as T } from '../content/messages';
import { CLOCK_RATES, DEFAULT_RATE_INDEX, rateFromSlider, rateLabel, type ClockMode } from './clock';

export interface ClockBarHandlers {
  onStep(): void;
  onMode(mode: ClockMode): void;
  onRate(ticksPerSec: number): void;
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
  private readonly rate = document.createElement('input');
  private readonly rateValue = document.createElement('span');
  private readonly counter = document.createElement('span');
  private key = '';

  constructor(host: HTMLElement, h: ClockBarHandlers) {
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
    const play = button(T.play, T.playTitle, () => h.onMode('play'));
    const instant = button(T.instant, T.instantTitle, () => h.onMode('instant'));
    this.modes.set('pause', pause).set('play', play).set('instant', instant);

    const speed = document.createElement('label');
    speed.className = 'clock-speed';
    speed.title = T.speedTitle;
    this.rate.type = 'range';
    this.rate.min = '0';
    this.rate.max = String(CLOCK_RATES.length - 1);
    this.rate.step = '1';
    this.rate.value = String(DEFAULT_RATE_INDEX);
    const applyRate = () => {
      const r = rateFromSlider(Number(this.rate.value));
      this.rateValue.textContent = rateLabel(r);
      h.onRate(r);
    };
    this.rate.addEventListener('input', applyRate);
    speed.append(this.rate, this.rateValue);
    applyRate();

    this.counter.className = 'clock-ticks';
    host.append(this.pulse, pause, this.step, play, speed, instant, this.counter);
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
    for (const [m, b] of this.modes) b.setAttribute('aria-pressed', String(m === s.mode));
    // Pause and Instant also matter without a clock (Instant skips the animation of inputs).
    this.modes.get('play')!.disabled = !s.enabled;
    this.step.disabled = !s.enabled;
    this.rate.disabled = !s.enabled;
    this.counter.textContent = s.enabled ? T.ticks(s.ticks) : '';
    this.counter.parentElement!.title = s.enabled ? '' : T.noClock;
  }
}

// "Schematic | Silicon" toggle and its opt-in legend (DESIGN.md §6.2a, Phase 4b). Shown only at
// gate and transistor level. Flipping it only changes how primitives are drawn: the simulation,
// playback and camera are not touched.
import { siliconText as T } from '../content/silicon';
import type { SiliconMode } from '../render/views';

export class ViewToggle {
  readonly root = document.createElement('div');
  private readonly schematicBtn = document.createElement('button');
  private readonly siliconBtn = document.createElement('button');
  private readonly legendBtn = document.createElement('button');
  private readonly legend = document.createElement('div');
  private legendOpen = false;
  private shown = false;

  constructor(host: HTMLElement, private readonly mode: SiliconMode, private readonly onChange: () => void = () => {}) {
    this.root.className = 'view-toggle';
    this.root.hidden = true;
    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', T.toggleTitle);
    group.title = T.toggleTitle;
    for (const [btn, text, on] of [[this.schematicBtn, T.schematic, false], [this.siliconBtn, T.silicon, true]] as const) {
      btn.type = 'button';
      btn.textContent = text;
      btn.addEventListener('click', () => this.set(on));
      group.append(btn);
    }
    this.legendBtn.type = 'button';
    this.legendBtn.className = 'legend-btn';
    this.legendBtn.textContent = T.legendButton;
    this.legendBtn.title = T.legendTitle;
    this.legendBtn.setAttribute('aria-controls', 'silicon-legend');
    this.legendBtn.addEventListener('click', () => {
      this.legendOpen = !this.legendOpen;
      this.refresh();
    });

    this.legend.id = 'silicon-legend';
    this.legend.className = 'legend';
    const h = document.createElement('strong');
    h.textContent = T.legendHeading;
    const list = document.createElement('ul');
    for (const item of T.legendItems) {
      const li = document.createElement('li');
      const sw = document.createElement('span');
      sw.className = `swatch ${item.swatch}`;
      sw.setAttribute('aria-hidden', 'true');
      const b = document.createElement('b');
      b.textContent = item.name;
      li.append(sw, b, document.createTextNode(` ${item.text}`));
      list.append(li);
    }
    const note = document.createElement('p');
    note.textContent = T.legendNote;
    const reality = document.createElement('p');
    reality.className = 'muted';
    reality.textContent = T.reality;
    this.legend.append(h, list, note, reality);

    const row = document.createElement('div');
    row.className = 'view-toggle-row';
    row.append(group, this.legendBtn);
    this.root.append(row, this.legend);
    host.append(this.root);
    this.refresh();
  }

  set(on: boolean): void {
    if (this.mode.on === on) return;
    this.mode.on = on;
    this.refresh();
    this.onChange();
  }

  /** Shown at gate and transistor level only. */
  set visible(v: boolean) {
    // Follow the mode even when something else changed it (dev handle, tests).
    if (this.schematicBtn.getAttribute('aria-pressed') !== String(!this.mode.on)) this.refresh();
    if (v === this.shown) return;
    this.shown = v;
    this.root.hidden = !v;
  }

  private refresh(): void {
    this.schematicBtn.setAttribute('aria-pressed', String(!this.mode.on));
    this.siliconBtn.setAttribute('aria-pressed', String(this.mode.on));
    // The legend belongs to the silicon drawing; it stays closed until asked for.
    this.legendBtn.hidden = !this.mode.on;
    this.legendBtn.setAttribute('aria-expanded', String(this.legendOpen));
    this.legend.hidden = !(this.mode.on && this.legendOpen);
  }
}

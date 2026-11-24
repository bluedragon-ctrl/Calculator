// Floating hover tooltip (HTML overlay, never bloomed).
import type { TooltipContent } from './describe';

export class Tooltip {
  private readonly el = document.createElement('div');

  constructor(host: HTMLElement) {
    this.el.className = 'tooltip';
    this.el.setAttribute('role', 'tooltip');
    this.el.hidden = true;
    host.append(this.el);
  }

  show(c: TooltipContent, x: number, y: number): void {
    const title = document.createElement('strong');
    title.textContent = c.title;
    const body = document.createElement('p');
    body.textContent = c.body;
    const parts: HTMLElement[] = [title, body];
    for (const v of c.values) {
      const line = document.createElement('div');
      line.className = 'value';
      line.textContent = v;
      parts.push(line);
    }
    if (c.hint) {
      const hint = document.createElement('div');
      hint.className = 'hint';
      hint.textContent = c.hint;
      parts.push(hint);
    }
    this.el.replaceChildren(...parts);
    this.el.hidden = false;
    // Keep it inside the view: flip to the left/top near the edges.
    const host = this.el.parentElement!;
    const w = this.el.offsetWidth;
    const h = this.el.offsetHeight;
    const left = x + 16 + w > host.clientWidth ? x - 16 - w : x + 16;
    const top = y + 16 + h > host.clientHeight ? Math.max(4, y - 16 - h) : y + 16;
    this.el.style.transform = `translate(${Math.max(4, left)}px, ${top}px)`;
  }

  hide(): void {
    this.el.hidden = true;
  }
}

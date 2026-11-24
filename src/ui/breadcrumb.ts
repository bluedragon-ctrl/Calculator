// Breadcrumb of the current zoom path (DESIGN.md §2): each part flies back out when clicked.
export interface Crumb {
  text: string;
  onClick?: () => void;
}

export class Breadcrumb {
  private readonly el = document.createElement('nav');
  private key = '';

  constructor(host: HTMLElement) {
    this.el.className = 'breadcrumb';
    this.el.setAttribute('aria-label', 'Zoom path');
    host.append(this.el);
  }

  set(crumbs: Crumb[]): void {
    const key = crumbs.map((c) => c.text).join('›');
    if (key === this.key) return;
    this.key = key;
    const items: HTMLElement[] = [];
    crumbs.forEach((c, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.textContent = '›';
        sep.setAttribute('aria-hidden', 'true');
        items.push(sep);
      }
      const last = i === crumbs.length - 1;
      if (c.onClick && !last) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = c.text;
        b.addEventListener('click', c.onClick);
        items.push(b);
      } else {
        const s = document.createElement('span');
        s.className = last ? 'current' : '';
        s.textContent = c.text;
        if (last) s.setAttribute('aria-current', 'location');
        items.push(s);
      }
    });
    this.el.replaceChildren(...items);
    // Long paths scroll; keep the current level in sight.
    this.el.scrollLeft = this.el.scrollWidth;
  }
}

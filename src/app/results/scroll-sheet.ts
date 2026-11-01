import {
  afterNextRender,
  Directive,
  ElementRef,
  inject,
  input,
  OnDestroy,
  signal,
} from '@angular/core';

/**
 * A table that scrolls sideways: knows whether there is more to either side, and pages by the
 * visible width (less the pinned test column), for buttons that work with any mouse.
 *
 * With `clone` and `anchor`, it also keeps a copy of the heading rows (`clone`) pinned under a
 * sticky panel heading (`anchor`) while the page scrolls through a long table: shown once the
 * real heading rows pass under the anchor, with the same column widths and sideways scroll.
 */
@Directive({
  selector: '[appScrollSheet]',
  exportAs: 'scrollSheet',
  host: {
    '(scroll)': 'update()',
    '(window:scroll)': 'place()',
    '[class.can-back]': 'canBack()',
    '[class.can-forward]': 'canForward()',
  },
})
export class ScrollSheet implements OnDestroy {
  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private observer?: ResizeObserver;
  readonly clone = input<HTMLElement | null>(null);
  readonly anchor = input<HTMLElement | null>(null);
  readonly canBack = signal(false);
  readonly canForward = signal(false);
  /** Whether the copy of the heading rows is showing. */
  readonly pinned = signal(false);

  constructor() {
    afterNextRender(() => {
      this.update();
      this.place();
      if (typeof ResizeObserver === 'undefined') return;
      this.observer = new ResizeObserver(() => {
        this.update();
        if (this.pinned()) this.matchWidths();
        this.place();
      });
      this.observer.observe(this.el);
      if (this.el.firstElementChild) this.observer.observe(this.el.firstElementChild);
    });
  }

  ngOnDestroy() {
    this.observer?.disconnect();
  }

  protected update() {
    const { scrollLeft, scrollWidth, clientWidth } = this.el;
    this.canBack.set(scrollLeft > 1);
    this.canForward.set(scrollLeft + clientWidth < scrollWidth - 1);
    const clone = this.clone();
    if (clone) clone.scrollLeft = scrollLeft;
  }

  /** Show the copy while the real heading rows are hidden under the anchor and rows remain. */
  protected place() {
    const anchor = this.anchor();
    const thead = this.el.querySelector('thead');
    if (!anchor || !thead || !this.clone()) return;
    const limit = anchor.getBoundingClientRect().bottom;
    const head = thead.getBoundingClientRect();
    const sheet = this.el.getBoundingClientRect();
    const pin = head.height > 0 && head.top < limit && sheet.bottom > limit + head.height * 2;
    if (pin === this.pinned()) return;
    if (pin) this.matchWidths();
    this.pinned.set(pin);
    // Shown in the next frame; line it up with the table's sideways scroll then.
    requestAnimationFrame(() => this.update());
  }

  /** Give every cell of the copy the width its twin has in the table, so columns line up. */
  private matchWidths() {
    const clone = this.clone();
    const table = this.el.querySelector('table');
    if (!clone || !table) return;
    const real = this.el.querySelectorAll<HTMLElement>('thead th');
    const copy = clone.querySelectorAll<HTMLElement>('thead th');
    real.forEach((th, i) => {
      const twin = copy[i];
      if (!twin) return;
      const width = `${th.getBoundingClientRect().width}px`;
      twin.style.width = twin.style.minWidth = twin.style.maxWidth = width;
      twin.style.boxSizing = 'border-box';
    });
    const copyTable = clone.querySelector('table');
    if (copyTable) copyTable.style.width = `${table.getBoundingClientRect().width}px`;
  }

  /** Scroll one screen of dates: 1 towards older, -1 towards newer. */
  page(direction: 1 | -1) {
    const pinned = this.el.querySelector('.test')?.getBoundingClientRect().width ?? 0;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.el.scrollBy({
      left: direction * Math.max(160, (this.el.clientWidth - pinned) * 0.85),
      behavior: reduced ? 'instant' : 'smooth',
    });
  }
}

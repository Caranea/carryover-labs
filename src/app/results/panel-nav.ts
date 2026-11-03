import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  input,
  OnDestroy,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from '../ui/icon';

/** A panel as the jump-to row lists it. */
export interface NavPanel {
  key: string;
  label: string;
  flagged: number;
}

/**
 * The jump-to row of panels: those with flagged values first, the most flagged first. It
 * scrolls sideways rather than wrapping, with a button at each edge that has more.
 */
@Component({
  selector: 'app-panel-nav',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.more-start]': 'edges().start',
    '[class.more-end]': 'edges().end',
  },
  template: `
    <nav #nav aria-label="Jump to a panel" (scroll)="update()">
      @for (p of sorted(); track p.key; let i = $index) {
        @if (i && !p.flagged && sorted()[i - 1].flagged) {
          <span class="split" aria-hidden="true"></span>
        }
        <a [href]="href(p.key)" (click)="$event.preventDefault(); jump.emit(p.key)"
          >{{ p.label }}
          @if (p.flagged) {
            <span class="count" [attr.aria-label]="p.flagged + ' flagged'">{{ p.flagged }}</span>
          }
        </a>
      }
    </nav>
    <!-- For pointers only: keyboard focus scrolls the row by itself. -->
    <button type="button" class="step back" tabindex="-1" aria-hidden="true" (click)="step(-1)">
      <span><app-icon name="chevron-left" size="1rem" /></span>
    </button>
    <button type="button" class="step fwd" tabindex="-1" aria-hidden="true" (click)="step(1)">
      <span><app-icon name="chevron-right" size="1rem" /></span>
    </button>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      flex: 1 1 14rem;
      min-width: 0;
    }
    nav {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      overflow-x: auto;
      scrollbar-width: none;
      padding: 3px;
      scroll-padding-inline: 3rem;
      font-size: 0.92rem;
    }
    nav::-webkit-scrollbar {
      display: none;
    }
    a {
      flex: none;
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      min-height: 2.5rem;
      padding: 0.3rem 0.9rem;
      border: 1px solid var(--color-base-300);
      border-radius: 999px;
      color: var(--ink);
      white-space: nowrap;
    }
    a:hover {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
    a:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .count {
      display: inline-grid;
      place-items: center;
      min-width: 1.2rem;
      height: 1.2rem;
      padding: 0 0.3rem;
      border-radius: 999px;
      background: var(--out);
      color: #fff;
      font-size: 0.75rem;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .split {
      flex: none;
      width: 1px;
      height: 1.25rem;
      margin: 0 0.25rem;
      background: var(--color-base-300);
    }
    .step {
      position: absolute;
      top: 0;
      bottom: 0;
      display: none;
      align-items: center;
      width: 4rem;
      padding: 0;
      border: 0;
      color: var(--ink);
      cursor: pointer;
    }
    .back {
      left: 0;
      justify-content: flex-start;
      background: linear-gradient(to left, transparent, var(--color-base-100) 55%);
    }
    .fwd {
      right: 0;
      justify-content: flex-end;
      background: linear-gradient(to right, transparent, var(--color-base-100) 55%);
    }
    :host(.more-start) .back,
    :host(.more-end) .fwd {
      display: flex;
    }
    .step > span {
      display: grid;
      place-items: center;
      width: 2.25rem;
      height: 2.25rem;
      border: 1px solid var(--color-base-300);
      border-radius: 999px;
      background: var(--color-base-100);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.12);
    }
    .step:hover > span {
      border-color: var(--color-primary);
      color: var(--color-primary);
    }
  `,
})
export class PanelNav implements OnDestroy {
  readonly panels = input.required<readonly NavPanel[]>();
  /** A panel was picked: scroll to it. */
  readonly jump = output<string>();

  private readonly router = inject(Router);
  private readonly nav = viewChild<ElementRef<HTMLElement>>('nav');
  protected readonly sorted = computed(() =>
    [...this.panels()].sort((a, b) => b.flagged - a.flagged),
  );
  /** Whether panels are hidden past the row's left or right edge. */
  protected readonly edges = signal({ start: false, end: false });
  private readonly resize =
    typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => this.update());

  constructor() {
    // Recheck the edges when the row is resized or its panels change.
    effect(() => {
      this.sorted();
      const el = this.nav()?.nativeElement;
      this.resize?.disconnect();
      if (el) this.resize?.observe(el);
      requestAnimationFrame(() => this.update());
    });
  }

  ngOnDestroy() {
    this.resize?.disconnect();
  }

  protected href(key: string) {
    return this.router.url.split('#')[0] + '#' + key;
  }

  protected update() {
    const el = this.nav()?.nativeElement;
    if (!el) return;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft < el.scrollWidth - el.clientWidth - 1;
    const now = this.edges();
    if (now.start !== start || now.end !== end) this.edges.set({ start, end });
  }

  /** Scroll the row by most of its width. */
  protected step(direction: 1 | -1) {
    const el = this.nav()?.nativeElement;
    el?.scrollBy({
      left: direction * el.clientWidth * 0.75,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  }
}

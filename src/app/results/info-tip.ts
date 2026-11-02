import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  OnDestroy,
  viewChild,
} from '@angular/core';

/**
 * A small "i" with an explanation on hover, focus or tap. The text sits in the top layer
 * (popover), so a sideways-scrolling table cannot clip it.
 */
@Component({
  selector: 'app-info-tip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:scroll)': 'hide()' },
  template: `
    <button
      #trigger
      type="button"
      class="i"
      [attr.aria-label]="label()"
      [attr.aria-describedby]="id"
      (mouseenter)="show()"
      (mouseleave)="hide()"
      (focus)="show()"
      (blur)="hide()"
      (click)="show()"
    >
      i
    </button>
    <span #tip [id]="id" popover="manual" role="tooltip" class="tip">{{ text() }}</span>
  `,
  styles: `
    :host {
      display: inline-block;
      vertical-align: 0.1em;
    }
    /* A 24 px target (WCAG 2.5.8) around a small drawn circle. */
    .i {
      position: relative;
      display: inline-grid;
      place-items: center;
      width: 1.5rem;
      height: 1.5rem;
      margin: -0.2rem 0;
      border: 0;
      background: none;
      color: var(--ink-soft, #4a5866);
      font:
        italic 600 0.75rem/1 Georgia,
        'Times New Roman',
        serif;
      cursor: help;
    }
    .i::before {
      content: '';
      position: absolute;
      inset: 0.22rem;
      border: 1px solid currentColor;
      border-radius: 999px;
    }
    .i:hover,
    .i:focus-visible {
      color: var(--color-primary);
    }
    .i:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 2px;
    }
    .tip {
      position: fixed;
      inset: auto;
      margin: 0;
      width: max-content;
      max-width: min(20rem, calc(100vw - 1rem));
      padding: 0.55rem 0.7rem;
      border: 0;
      border-radius: 0.5rem;
      background: #1b2733;
      color: #fff;
      font-size: 0.8rem;
      font-weight: 400;
      line-height: 1.45;
      white-space: normal;
      text-align: left;
      box-shadow: 0 8px 24px rgb(0 0 0 / 0.18);
    }
  `,
})
export class InfoTip implements OnDestroy {
  private static next = 0;
  readonly text = input.required<string>();
  readonly label = input('More about this');
  protected readonly id = `info-tip-${InfoTip.next++}`;
  private readonly trigger = viewChild.required<ElementRef<HTMLElement>>('trigger');
  private readonly tip = viewChild.required<ElementRef<HTMLElement>>('tip');
  private open = false;

  protected show() {
    const tip = this.tip().nativeElement;
    if (this.open || typeof tip.showPopover !== 'function') return;
    tip.showPopover();
    this.open = true;
    const at = this.trigger().nativeElement.getBoundingClientRect();
    const width = tip.offsetWidth;
    const height = tip.offsetHeight;
    const left = Math.min(Math.max(8, at.left + at.width / 2 - width / 2), innerWidth - width - 8);
    const below = at.bottom + 6 + height <= innerHeight - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${below ? at.bottom + 6 : at.top - 6 - height}px`;
  }

  protected hide() {
    if (!this.open) return;
    this.tip().nativeElement.hidePopover();
    this.open = false;
  }

  ngOnDestroy() {
    this.hide();
  }
}

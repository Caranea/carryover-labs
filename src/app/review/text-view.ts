import { Component, computed, input, output } from '@angular/core';
import { WorkingPage, WorkingWord } from '../core/models';
import { describeWord } from './describe';
import { redactionAction, redactionPlan } from '../redaction/burn';

type PreviewWord = WorkingWord & { derived?: boolean };

/**
 * The page as lines of words. Used for Word and text files, and as a
 * keyboard-friendly alternative to the image for any page.
 */
@Component({
  selector: 'app-text-view',
  template: `
    <div class="text" [class.reveal]="reveal()">
      @for (line of lines(); track $index) {
        <p>
          @for (w of line; track w.id) {
            @if (w.hidden) {
              <button
                type="button"
                class="w redacted"
                [disabled]="w.locked"
                [title]="describe(w)"
                [attr.aria-label]="describe(w)"
                (click)="activate(w)"
              >
                @if (reveal() && w.text) {
                  {{ w.text }}
                } @else {
                  <span class="bar" [style.width.ch]="barWidth(w)"></span>
                }
              </button>
            } @else {
              <button
                type="button"
                class="w"
                [class.candidate]="!!w.candidate && !w.userSet"
                [title]="
                  w.candidate && !w.userSet
                    ? 'Possible personal detail. Still visible; click to hide.'
                    : 'Click to hide'
                "
                (click)="toggleWord.emit(w.id)"
              >
                {{ w.text }}
              </button>
            }
            {{ ' ' }}
          }
        </p>
      }
    </div>
  `,
  styles: `
    .text {
      background: #fff;
      border-radius: 0.5rem;
      box-shadow:
        0 1px 2px rgba(22, 48, 44, 0.08),
        0 12px 32px -16px rgba(22, 48, 44, 0.35);
      padding: clamp(1rem, 4vw, 2.5rem);
      line-height: 2;
      overflow-wrap: anywhere;
    }
    p {
      min-height: 1.9em;
    }
    .w {
      border: 0;
      background: none;
      padding: 0 2px;
      margin: 0;
      font: inherit;
      color: inherit;
      cursor: pointer;
      border-radius: 4px;
      line-height: inherit;
    }
    .w:hover {
      background: color-mix(in oklab, var(--color-accent) 45%, transparent);
    }
    .w.candidate {
      background: #fff2bc;
      border-bottom: 1px dashed #ad7100;
    }
    .w:focus-visible {
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }
    .w.redacted:disabled {
      cursor: not-allowed;
    }
    .reveal .w.redacted {
      box-shadow: inset 0 0 0 2px #000;
      background: rgba(0, 0, 0, 0.05);
    }
    .bar {
      forced-color-adjust: none;
      display: inline-block;
      height: 1.05em;
      background: #000;
      border-radius: 2px;
      vertical-align: -0.15em;
    }
  `,
})
export class TextView {
  readonly page = input.required<WorkingPage>();
  readonly reveal = input(false);
  readonly toggleWord = output<number>();
  readonly removeRegion = output<number>();
  private readonly plan = computed(() => redactionPlan(this.page()));

  protected readonly lines = computed(() => {
    const out: PreviewWord[][] = [];
    let current = -1;
    const page = this.page();
    const plan = this.plan();
    for (const [index, original] of page.words.entries()) {
      const w: PreviewWord = {
        ...original,
        hidden: plan.hidden.has(index),
        derived: !original.hidden && plan.hidden.has(index),
        locked: redactionAction(page, index, plan) === null,
      };
      if (w.line !== current) {
        // Keep blank lines between paragraphs visible.
        const gap = current < 0 ? 0 : Math.min(2, w.line - current - 1);
        for (let i = 0; i < gap; i++) out.push([]);
        out.push([]);
        current = w.line;
      }
      out[out.length - 1].push(w);
    }
    return out;
  });

  protected describe(w: PreviewWord) {
    if (w.derived)
      return w.locked
        ? 'Covered by a previously removed detail.'
        : 'Covered by a nearby hidden detail. Activate to undo the original removal.';
    return describeWord(w, false);
  }

  protected activate(w: WorkingWord) {
    const page = this.page();
    const action = redactionAction(
      page,
      page.words.findIndex((word) => word.id === w.id),
      this.plan(),
    );
    if (action && 'wordId' in action) this.toggleWord.emit(action.wordId);
    else if (action) this.removeRegion.emit(action.regionIndex);
  }

  protected barWidth(w: WorkingWord): number {
    return Math.max(3, Math.min(14, w.text?.length ?? 6));
  }
}

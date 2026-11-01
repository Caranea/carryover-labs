import { Component, computed, inject, input } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter, map } from 'rxjs';
import { DocumentQueueService } from '../core/document-queue.service';

/** Where the user is in the add, check, view flow. */
@Component({
  selector: 'app-step-rail',
  host: { '[class.inline]': 'inline()' },
  template: `
    <ul class="steps steps-horizontal step-rail" aria-label="Steps">
      <li
        class="step"
        [class.step-primary]="index() >= 0"
        [attr.aria-current]="index() === 0 ? 'step' : null"
      >
        Add files
      </li>
      <li
        class="step"
        [class.step-primary]="index() >= 1"
        [attr.aria-current]="index() === 1 ? 'step' : null"
      >
        Check &amp; approve
      </li>
      <li
        class="step"
        [class.step-primary]="index() >= 2"
        [attr.aria-current]="index() === 2 ? 'step' : null"
      >
        Results
      </li>
    </ul>
  `,
  styles: `
    :host {
      position: fixed;
      inset-inline: 0;
      bottom: 0;
      z-index: 40;
      display: block;
      width: 100%;
      padding: 0.375rem clamp(0.5rem, 2vw, 2rem) calc(0.375rem + env(safe-area-inset-bottom));
      border-top: 1px solid var(--color-base-300);
      background: rgb(255 255 255 / 97%);
      box-shadow: 0 -6px 22px rgb(22 48 44 / 8%);
      backdrop-filter: blur(12px);
    }

    :host(.inline) {
      position: static;
      padding: 0;
      border: 0;
      background: none;
      box-shadow: none;
      backdrop-filter: none;
    }

    .step-rail {
      display: grid;
      width: 100%;
      grid-auto-columns: minmax(0, 1fr);
      overflow: visible;
    }

    .step-rail .step {
      min-width: 0;
      grid-template-rows: 1.375rem 1rem;
      font-size: clamp(0.75rem, 1.5vw, 0.875rem);
      line-height: 1rem;
      white-space: nowrap;
    }

    .step-rail .step::before {
      height: 0.1875rem;
    }
    .step-rail .step::after {
      width: 1.375rem;
      height: 1.375rem;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .step-rail .step[aria-current='step'] {
      color: var(--color-primary);
      font-weight: 700;
    }
  `,
})
export class StepRail {
  readonly inline = input(false);
  private readonly queue = inject(DocumentQueueService);
  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly index = computed(() =>
    this.queue.reviewOpened() || this.queue.resultsBlocked()
      ? 1
      : /^\/(results|demo)/.test(this.url())
        ? 2
        : /^\/(review|saved)/.test(this.url()) || this.queue.batch().length
          ? 1
          : 0,
  );
}

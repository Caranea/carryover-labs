import { Component, inject } from '@angular/core';
import { AnalyticsService } from '../core/analytics';

/** Asks before Google Analytics loads. Accept and Decline carry the same weight on purpose. */
@Component({
  selector: 'app-cookie-banner',
  template: `
    @if (analytics.choosing()) {
      <section
        class="no-print flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4 text-sm shadow-lg"
        aria-labelledby="cookie-h"
      >
        <h2 id="cookie-h" class="font-semibold">Analytics cookies</h2>
        <p class="text-base-content/80">
          May we use Google Analytics to count visits to our home and demo pages? It doesn't run on
          your documents or results. You can change this in the footer.
        </p>
        <div class="flex justify-end gap-2">
          <button
            type="button"
            class="btn btn-primary btn-outline btn-sm rounded-full"
            (click)="analytics.decline()"
          >
            Decline
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm rounded-full"
            (click)="analytics.accept()"
          >
            Accept
          </button>
        </div>
      </section>
    }
  `,
  styles: `
    :host {
      position: fixed;
      inset-inline-end: 1rem;
      bottom: 1rem;
      z-index: 45;
      width: min(22rem, calc(100vw - 2rem));
    }
  `,
})
export class CookieBanner {
  protected readonly analytics = inject(AnalyticsService);
}

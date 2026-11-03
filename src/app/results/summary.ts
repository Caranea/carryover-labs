import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/**
 * The counts above the results: small tiles on screen, "To check" tinted as the one to act on;
 * a ruled row in print.
 */
@Component({
  selector: 'app-results-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="report-head" aria-label="Summary">
      <dl>
        <div>
          <dt>Documents</dt>
          <dd>{{ documents() }}</dd>
        </div>
        <div>
          <dt>Tests</dt>
          <dd>{{ tests() }}</dd>
        </div>
        <div>
          <dt>Values</dt>
          <dd>{{ values() }}</dd>
        </div>
        <div>
          <dt>Time span</dt>
          <dd>{{ span() }}</dd>
        </div>
        @if (toCheck()) {
          <div class="check">
            <dt>To check</dt>
            <dd>
              <a
                class="link"
                [href]="checkHref()"
                (click)="$event.preventDefault(); check.emit()"
                >{{ toCheck() }}</a
              >
            </dd>
          </div>
        }
      </dl>
    </section>
  `,
  styles: `
    :host {
      display: block;
      min-width: 0;
      color: var(--ink);
    }
    dl {
      display: flex;
      gap: 0.5rem;
    }
    dl > div {
      min-width: 5.25rem;
      padding: 0.45rem 0.75rem 0.5rem;
      border: 1px solid var(--color-base-300);
      border-radius: 0.625rem;
      background: var(--band);
    }
    dt {
      font-size: 0.75rem;
      color: var(--ink-soft);
    }
    dd {
      font-size: 1.125rem;
      font-weight: 700;
      line-height: 1.3;
      font-variant-numeric: tabular-nums;
    }
    .check {
      border-color: color-mix(in oklab, var(--out) 30%, #fff);
      background: color-mix(in oklab, var(--out) 7%, #fff);
    }
    .check dt,
    .check a {
      color: var(--out);
    }
    /* Phones: one row that scrolls sideways, "To check" first. */
    @media (width < 48rem) {
      dl {
        overflow-x: auto;
        scrollbar-width: none;
      }
      dl::-webkit-scrollbar {
        display: none;
      }
      dl > div {
        flex: none;
      }
      .check {
        order: -1;
      }
    }
    @media (width >= 48rem) {
      dl {
        flex-wrap: wrap;
      }
    }
    @media print {
      dl {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(28mm, 1fr));
        gap: 0;
        border-top: 2px solid var(--ink);
        border-bottom: 1px solid var(--rule);
      }
      dl > div {
        min-width: 0;
        padding: 0.6rem 0.75rem 0.7rem 0;
        border: 0;
        border-radius: 0;
        background: none;
      }
      .check dt {
        color: var(--ink-soft);
      }
      .check a {
        color: var(--ink);
      }
      dd {
        font-size: 13pt;
        font-weight: 600;
      }
    }
  `,
})
export class ResultsSummary {
  readonly documents = input.required<number>();
  readonly tests = input.required<number>();
  readonly values = input.required<number>();
  readonly span = input.required<string>();
  /** Readings still to check; the tile is left out when there are none. */
  readonly toCheck = input(0);
  readonly checkHref = input('');
  /** "To check" was picked: scroll to those readings. */
  readonly check = output<void>();
}

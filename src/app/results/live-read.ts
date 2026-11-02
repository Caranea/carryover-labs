import { DecimalPipe } from '@angular/common';
import {
  afterRenderEffect,
  Component,
  computed,
  ElementRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
  viewChild,
} from '@angular/core';
import type { PageJobView } from '@shared/jobs';
import { MAX_WAIT_SECONDS } from '@shared/jobs';
import { PROCESSING_VERSION, type PrintedRow } from '@shared/processing';
import type { RecordsResponse } from '@shared/records';
import { BusyError, JobClient } from '../core/job-client';
import { ServerConfigService } from '../core/server-config';
import { Icon } from '../ui/icon';

/** Fictional pages with their identifiers already blacked out, as an approved copy would be. */
interface LiveSample {
  key: string;
  /** The sample patient page it is: the server replays Meta's recorded answer for it. */
  sample: string;
  src: string;
  width: number;
  height: number;
  title: string;
  detail: string;
  language: string;
}
const SAMPLES: LiveSample[] = [
  {
    key: 'polish-thyroid',
    sample: 'jane-doe-lab-10:0',
    src: 'samples/live/polish-thyroid.jpg',
    width: 1100,
    height: 1559,
    title: 'Polish PDF',
    detail: '3 thyroid tests · quick',
    language: 'pl',
  },
  {
    key: 'german-cumulative',
    sample: 'jane-doe-002:0',
    src: 'samples/live/german-cumulative.jpg',
    width: 1200,
    height: 1594,
    title: 'German phone photo',
    detail: '28 tests · dense',
    language: 'de',
  },
];

type Phase = 'idle' | 'reading' | 'identifying' | 'done' | 'error';
interface Identity {
  status: 'charted' | 'text' | 'held';
  label: string | null;
  value: number | null;
  unit: string | null;
  note: string | null;
}
/** A connector from a highlighted line on the page to its card, in body-relative pixels. */
interface Wire {
  index: number;
  d: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Models {
  transcription: string;
  identification: string;
}

/**
 * An approved, fictional page goes through the same job API as a user's page: Muse Spark's
 * transcription, then Muse Wonder's identity of each printed test. Both answers are Meta's real
 * ones for this page, recorded once and replayed by the server, so the demo costs nothing.
 */
@Component({
  selector: 'app-live-read',
  imports: [Icon, DecimalPipe],
  host: { '(window:resize)': 'measure()' },
  template: `
    <section
      class="live rounded-box border border-base-300 bg-base-100 p-5 sm:p-8"
      aria-labelledby="live-h"
    >
      <div class="live-head">
        <div class="min-w-0">
          <h2 id="live-h" class="text-2xl sm:text-3xl tracking-tight">
            <span class="font-bold">Watch Meta's AI read a page</span>{{ ' '
            }}<span class="font-light">line by line</span>
          </h2>
          <p class="mt-2 max-w-2xl text-base-content/80 leading-relaxed">
            Pick one of Jane's pages. It goes through the real pipeline, with personal details
            already blacked out. Meta's answers for Jane's pages are real, recorded once and
            replayed, so this is instant and free. Your own documents are read live.
          </p>
        </div>
        @if (models()) {
          <ol class="models" aria-label="The two models, in order">
            <li>
              <span class="step">1</span>
              <span class="flex flex-col">
                <strong>{{ spark() }}</strong>
                <small>copies each line as printed</small>
              </span>
            </li>
            <li>
              <span class="step">2</span>
              <span class="flex flex-col">
                <strong>{{ wonder() }}</strong>
                <small>names the test, in any language</small>
              </span>
            </li>
          </ol>
        }
      </div>

      @if (models() === null) {
        <p class="mt-4 text-sm">The sample answers aren't on this server.</p>
      } @else {
        <div #body class="live-body">
          <div class="side flex flex-col min-w-0">
            <fieldset class="chooser" [disabled]="running()">
              <legend class="sr-only">Choose a page</legend>
              @for (s of samples; track s.key) {
                <label class="choice" [class.chosen]="chosen().key === s.key">
                  <input
                    type="radio"
                    name="live-sample"
                    class="sr-only"
                    [checked]="chosen().key === s.key"
                    (change)="choose(s)"
                  />
                  <img [src]="s.src" alt="" width="30" height="42" />
                  <span class="flex flex-col min-w-0">
                    <span class="font-semibold">{{ s.title }}</span>
                    <span class="text-sm text-base-content/70">{{ s.detail }}</span>
                  </span>
                </label>
              }
            </fieldset>
            <div class="mt-3 flex gap-2">
              <button
                type="button"
                class="btn btn-primary rounded-full flex-1"
                [disabled]="running()"
                (click)="run()"
              >
                <app-icon name="scan" size="1.1rem" />
                {{
                  running()
                    ? 'Reading…'
                    : phase() === 'done' || phase() === 'error'
                      ? 'Read it again'
                      : 'Read it'
                }}
              </button>
              @if (running()) {
                <button type="button" class="btn btn-ghost rounded-full" (click)="cancel()">
                  Stop
                </button>
              }
            </div>

            <figure class="sheet-wrap">
              <div class="sheet">
                <img
                  [src]="shown().src"
                  [width]="shown().width"
                  [height]="shown().height"
                  class="block w-full h-auto"
                  [alt]="
                    shown().title +
                    (rows().length ? ', with the rows the model found highlighted' : '')
                  "
                  (load)="measure()"
                />
                @if (phase() === 'reading') {
                  <span class="sweep" aria-hidden="true"></span>
                }
                @for (r of rows(); track $index) {
                  @if (r.region; as b) {
                    <span
                      class="mark"
                      [class.on]="focused() === $index"
                      [attr.data-row]="$index"
                      [style.left.%]="b[0] * 100"
                      [style.top.%]="b[1] * 100"
                      [style.width.%]="b[2] * 100"
                      [style.height.%]="b[3] * 100"
                      aria-hidden="true"
                    ></span>
                    @if (few()) {
                      <span
                        class="pin on-page"
                        [attr.data-pin]="$index"
                        [style.left]="'min(' + (b[0] + b[2]) * 100 + '%, calc(100% - 1.6rem))'"
                        [style.top.%]="(b[1] + b[3] / 2) * 100"
                        aria-hidden="true"
                        >{{ $index + 1 }}</span
                      >
                    }
                  }
                }
              </div>
              <figcaption class="mt-2 flex items-center gap-1.5 text-sm text-base-content/70">
                <app-icon name="lock" size="0.9rem" /> Personal details are already blacked out, as
                they would be after your own review.
              </figcaption>
            </figure>
          </div>

          <div class="out min-w-0" aria-live="polite">
            @if (phase() === 'idle' && !rows().length) {
              <div class="empty">
                <p class="font-display text-2xl leading-tight tracking-tight">
                  <span class="font-bold">A printed line goes in,</span><br />
                  <span class="font-light">a test you can chart comes out</span>
                </p>
                <div class="example">
                  <span class="text-base-content/80" lang="pl">TSH (ICD-9: L69)</span>
                  <app-icon name="arrow-right" size="1rem" />
                  <span class="font-semibold">Thyroid-stimulating hormone</span>
                </div>
                <div class="example">
                  <span class="text-base-content/80" lang="de">Thrombozyten</span>
                  <app-icon name="arrow-right" size="1rem" />
                  <span class="font-semibold">Platelets</span>
                </div>
                <p class="text-base-content/80 leading-relaxed">
                  Press <strong>Read it</strong>. Each line {{ spark() }} finds is highlighted on
                  the page and lands here, then {{ wonder() }} gives it its standard name.
                </p>
              </div>
            } @else {
              <ol class="steps-live">
                @if (phase() !== 'idle') {
                  <li [class.active]="phase() === 'reading'" [class.finished]="sparkDone()">
                    <strong>{{ spark() }}</strong>
                    {{ sparkDone() ? 'read the page' : 'is reading the page' }}
                    @if (rows().length) {
                      <span class="tabular-nums text-base-content/70">
                        · {{ rows().length }} rows
                      </span>
                    }
                  </li>
                }
                @if (sparkDone()) {
                  <li
                    [class.active]="phase() === 'identifying'"
                    [class.finished]="phase() === 'done'"
                  >
                    <strong>{{ wonder() }}</strong>
                    {{ phase() === 'done' ? 'named each test' : 'is naming each test' }}
                  </li>
                }
              </ol>
              @if (error(); as e) {
                <p role="alert" class="alert alert-error alert-soft mt-3">{{ e }}</p>
              }

              @if (rows().length) {
                <ol class="rows" aria-label="What the models read and identified">
                  @for (r of rows(); track $index) {
                    <li
                      tabindex="0"
                      class="row"
                      [attr.data-card]="$index"
                      [class.on]="focused() === $index"
                      [class.pending]="phase() === 'identifying' && !identity($index)"
                      (mouseenter)="focused.set($index)"
                      (focus)="focused.set($index)"
                      (mouseleave)="focused.set(null)"
                      (blur)="focused.set(null)"
                    >
                      <span class="pin" aria-hidden="true">{{ $index + 1 }}</span>
                      <div class="min-w-0">
                        <p class="text-sm text-base-content/80">
                          Printed:
                          <span
                            class="highlight text-base-content"
                            [attr.lang]="shown().language"
                            >{{ r.name ?? 'Unreadable' }}</span
                          >
                          @if (r.value) {
                            · {{ r.value }} {{ r.unit }}
                          }
                        </p>
                        @if (r.doubt) {
                          <p class="mt-1 text-xs text-warning-content">
                            Hard to read: {{ r.doubt }}
                          </p>
                        }
                        @if (identity($index); as id) {
                          @if (id.status === 'held') {
                            <p class="mt-1 text-base-content/80">Held for review: {{ id.note }}</p>
                          } @else {
                            <p class="name">{{ id.label }}</p>
                            @if (id.status === 'text' && id.note) {
                              <p class="text-sm text-base-content/80">{{ id.note }}</p>
                            }
                          }
                        } @else if (phase() === 'identifying') {
                          <p class="mt-1.5 flex items-center gap-2 text-base-content/70">
                            <span class="loading loading-dots loading-xs" aria-hidden="true"></span>
                            {{ wonder() }} is naming this test…
                          </p>
                        } @else if (phase() === 'done') {
                          <p class="mt-1 text-base-content/70">Not identified</p>
                        }
                      </div>
                      <div class="value">
                        @if (identity($index); as id) {
                          @if (id.value !== null) {
                            <span class="v">{{ id.value | number: '1.0-3' }}</span>
                            <span class="u">{{ id.unit }}</span>
                          }
                        }
                        @if (flagText(r.flag); as f) {
                          <span class="flag">{{ f }}</span>
                        }
                      </div>
                    </li>
                  }
                </ol>
                <p class="mt-4 flex items-center gap-1.5 text-sm text-base-content/70">
                  <app-icon name="check" size="0.95rem" /> Every value in the app links back to the
                  exact line it was read from.
                </p>
              }
            }
          </div>

          @if (wires().length) {
            <svg class="wires" aria-hidden="true">
              @for (w of wires(); track w.index) {
                <g [class.on]="focused() === w.index">
                  <path [attr.d]="w.d" />
                  <circle [attr.cx]="w.x1" [attr.cy]="w.y1" r="3" />
                  <circle [attr.cx]="w.x2" [attr.cy]="w.y2" r="3" />
                </g>
              }
            </svg>
          }
        </div>
      }
    </section>
  `,
  styles: `
    .live-head {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: flex-end;
      gap: 1.25rem 2.5rem;
    }
    .models {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.6rem;
    }
    .models li {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      padding: 0.55rem 0.9rem 0.55rem 0.6rem;
      border: 1px solid var(--color-base-300);
      border-radius: var(--radius-field);
      line-height: 1.25;
    }
    .models li + li::before {
      content: '→';
      margin: 0 0.35rem 0 -1.6rem;
      color: color-mix(in oklab, var(--color-base-content) 55%, transparent);
    }
    .models li + li {
      margin-left: 1.4rem;
    }
    .models small {
      font-size: 0.82rem;
      color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
    }
    .step,
    .pin {
      display: grid;
      place-items: center;
      flex: none;
      border-radius: 50%;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .step {
      width: 1.75rem;
      height: 1.75rem;
      font-size: 0.85rem;
      background: color-mix(in oklab, var(--color-primary) 10%, #fff);
      color: var(--color-primary);
    }
    .pin {
      width: 1.6rem;
      height: 1.6rem;
      font-size: 0.75rem;
      background: var(--color-primary);
      color: var(--color-primary-content);
    }

    .live-body {
      position: relative;
      display: grid;
      gap: 1.75rem;
      margin-top: 1.75rem;
    }
    /* On a phone: choose and run, then the results, then the tall page. */
    @media (max-width: 63.999rem) {
      .live-body {
        gap: 1rem;
      }
      .side {
        display: contents;
      }
      .out {
        order: 1;
      }
      .sheet-wrap {
        order: 2;
        margin-top: 0.75rem;
      }
    }
    @media (max-width: 39.999rem) {
      .models {
        flex-direction: column;
        align-items: stretch;
      }
      .models li + li {
        margin-left: 0;
      }
      .models li + li::before {
        content: none;
      }
      .rows .row {
        grid-template-columns: auto minmax(0, 1fr);
      }
      .row .value {
        grid-column: 2;
        flex-direction: row;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.4rem;
        text-align: left;
      }
    }
    @media (min-width: 64rem) {
      .live-body {
        grid-template-columns: minmax(0, 31rem) minmax(0, 1fr);
        gap: 3rem;
      }
    }

    .chooser {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
      gap: 0.6rem;
    }
    .choice {
      display: flex;
      align-items: center;
      gap: 0.7rem;
      min-height: 44px;
      padding: 0.5rem 0.9rem 0.5rem 0.5rem;
      border: 1px solid var(--color-base-300);
      border-radius: var(--radius-field);
      cursor: pointer;
    }
    .choice.chosen {
      border-color: var(--color-primary);
      box-shadow: inset 0 0 0 1px var(--color-primary);
      background: color-mix(in oklab, var(--color-primary) 6%, #fff);
    }
    .choice:has(input:focus-visible) {
      outline: 3px solid var(--color-primary);
      outline-offset: 3px;
    }
    fieldset:disabled .choice {
      cursor: default;
      opacity: 0.7;
    }
    .choice img {
      width: 30px;
      height: 42px;
      flex: none;
      object-fit: cover;
      object-position: top;
      border: 1px solid var(--color-base-300);
      border-radius: 3px;
    }

    .sheet-wrap {
      margin-top: 1.1rem;
    }
    .sheet {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--color-base-300);
      border-radius: 0.6rem;
      background: #fff;
      box-shadow: 0 18px 40px -26px rgb(22 48 44 / 0.45);
    }
    /* The highlighter: what the model kept, drawn over the page like the landing page's stroke. */
    .mark {
      position: absolute;
      border-radius: 3px;
      background: var(--color-accent);
      mix-blend-mode: multiply;
      opacity: 0.55;
      transition: opacity 0.15s;
      animation: mark-in 0.45s ease-out both;
    }
    .mark.on {
      opacity: 1;
      outline: 2px solid var(--color-primary);
      outline-offset: 1px;
    }
    .pin.on-page {
      position: absolute;
      transform: translate(0.3rem, -50%);
      box-shadow: 0 0 0 2px #fff;
      width: 1.25rem;
      height: 1.25rem;
      font-size: 0.65rem;
    }
    @keyframes mark-in {
      from {
        clip-path: inset(0 100% 0 0);
      }
      to {
        clip-path: inset(0 0 0 0);
      }
    }
    .sweep {
      position: absolute;
      left: 0;
      right: 0;
      height: 14%;
      background: linear-gradient(
        transparent,
        color-mix(in oklab, var(--color-accent) 45%, transparent) 80%,
        var(--color-accent)
      );
      mix-blend-mode: multiply;
      animation: sweep 2.4s ease-in-out infinite alternate;
    }
    @keyframes sweep {
      from {
        top: -14%;
      }
      to {
        top: 100%;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .sweep {
        display: none;
      }
    }

    .empty {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 1rem;
      height: 100%;
      padding: 1.75rem;
      border: 1px dashed var(--color-base-300);
      border-radius: var(--radius-box);
      background: var(--color-base-200);
    }
    .example {
      display: grid;
      grid-template-columns: auto auto 1fr;
      align-items: center;
      gap: 0.75rem;
      padding: 0.7rem 0.9rem;
      border: 1px solid var(--color-base-300);
      border-radius: var(--radius-field);
      background: var(--color-base-100);
    }
    .example app-icon {
      color: var(--color-primary);
    }

    .steps-live {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .steps-live li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      align-items: baseline;
    }
    .steps-live li::before {
      content: '';
      width: 0.6rem;
      height: 0.6rem;
      border-radius: 50%;
      border: 2px solid var(--color-base-300);
      align-self: center;
    }
    .steps-live li.active::before {
      border-color: var(--color-primary);
      animation: pulse 1.2s ease-in-out infinite;
    }
    .steps-live li.finished::before {
      background: var(--color-primary);
      border-color: var(--color-primary);
      animation: none;
    }
    @keyframes pulse {
      50% {
        opacity: 0.3;
      }
    }

    .rows {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      margin-top: 1.25rem;
    }
    .row {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: start;
      gap: 0.9rem;
      padding: 0.9rem 1.1rem;
      border: 1px solid var(--color-base-300);
      border-radius: var(--radius-box);
      background: var(--color-base-100);
      transition:
        border-color 0.15s,
        box-shadow 0.15s;
      animation: row-in 0.35s ease-out both;
    }
    .row.pending {
      border-style: dashed;
    }
    .row.on {
      border-color: var(--color-primary);
      box-shadow:
        0 0 0 1px var(--color-primary),
        0 10px 24px -18px var(--color-primary);
    }
    .row:focus-visible {
      outline-offset: 2px;
    }
    @keyframes row-in {
      from {
        opacity: 0;
        transform: translateY(4px);
      }
    }
    .name {
      margin-top: 0.3rem;
      font-family: var(--font-display);
      font-size: 1.2rem;
      font-weight: 600;
      line-height: 1.25;
    }
    .value {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.15rem;
      text-align: right;
    }
    .value .v {
      font-family: var(--font-display);
      font-size: 1.45rem;
      font-weight: 600;
      line-height: 1.1;
      font-variant-numeric: tabular-nums;
    }
    .value .u {
      font-size: 0.85rem;
      color: color-mix(in oklab, var(--color-base-content) 70%, transparent);
    }
    .flag {
      margin-top: 0.25rem;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
      white-space: nowrap;
      background: color-mix(in oklab, var(--color-warning) 22%, #fff);
      color: var(--color-warning-content);
    }

    /* Connectors from each highlighted line to its card, only when the two sit side by side. */
    .wires {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: none;
    }
    .wires path {
      fill: none;
      stroke: var(--color-primary);
      stroke-width: 1.5;
      stroke-dasharray: 3 4;
      opacity: 0.5;
    }
    .wires circle {
      fill: var(--color-primary);
      opacity: 0.6;
    }
    .wires g.on path {
      stroke-dasharray: none;
      opacity: 1;
    }
    .wires g.on circle {
      opacity: 1;
    }
    @media (prefers-reduced-motion: reduce) {
      .steps-live li.active::before,
      .mark,
      .row {
        animation: none;
      }
    }
  `,
})
export class LiveRead implements OnInit, OnDestroy {
  private readonly server = inject(ServerConfigService);
  protected readonly samples = SAMPLES;
  protected readonly chosen = signal(SAMPLES[0]);
  protected readonly readSample = signal<LiveSample | null>(null);
  protected readonly models = signal<Models | null | undefined>(undefined);
  protected readonly phase = signal<Phase>('idle');
  protected readonly rows = signal<PrintedRow[]>([]);
  protected readonly records = signal<RecordsResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly focused = signal<number | null>(null);
  protected readonly sparkDone = signal(false);
  private run$: AbortController | null = null;
  private client: JobClient | null = null;
  private pageId = '';

  protected readonly running = computed(
    () => this.phase() === 'reading' || this.phase() === 'identifying',
  );
  protected readonly spark = computed(() => modelLabel(this.models()?.transcription, 'Muse Spark'));
  protected readonly wonder = computed(() =>
    modelLabel(this.models()?.identification, 'Muse Wonder'),
  );
  private readonly identities = computed(() => identitiesOf(this.records()));
  /** The page on screen: the one being read, or the one chosen before reading. */
  protected readonly shown = computed(() => this.readSample() ?? this.chosen());
  /** Number every line and connect every card while there are few; on a dense page, only the focused one. */
  protected readonly few = computed(() => this.rows().length <= 8);
  protected readonly wires = signal<Wire[]>([], {
    equal: (a, b) => a.length === b.length && a.every((w, i) => w.d === b[i].d),
  });
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  constructor() {
    // Re-draw the connectors after every render that can move a line or a card.
    afterRenderEffect(() => {
      this.rows();
      this.records();
      this.phase();
      this.focused();
      this.measure();
    });
  }

  async ngOnInit() {
    void document.fonts?.ready.then(() => this.measure());
    const config = await this.server.load();
    this.models.set(config?.samplePatient ? config.models : null);
  }

  ngOnDestroy() {
    this.cancel();
  }

  protected choose(sample: LiveSample) {
    this.chosen.set(sample);
    if (this.running() || this.readSample()?.key === sample.key) return;
    this.readSample.set(null);
    this.rows.set([]);
    this.records.set(null);
    this.error.set(null);
    this.phase.set('idle');
  }

  protected flagText(flag: string | null): string | null {
    if (!flag) return null;
    const f = flag.trim().toUpperCase();
    if (f.startsWith('H')) return 'Lab flagged high';
    if (f.startsWith('L')) return 'Lab flagged low';
    return 'Lab flagged';
  }

  /** Lay out the connectors; only when the page and the cards sit side by side. */
  protected measure() {
    const body = this.body()?.nativeElement;
    if (!body || !this.rows().length || !matchMedia('(min-width: 64rem)').matches) {
      this.wires.set([]);
      return;
    }
    const box = body.getBoundingClientRect();
    const focused = this.focused();
    const wires: Wire[] = [];
    for (const card of body.querySelectorAll<HTMLElement>('[data-card]')) {
      const index = Number(card.dataset['card']);
      if (!this.few() && index !== focused) continue;
      const start =
        body.querySelector<HTMLElement>(`[data-pin="${index}"]`) ??
        body.querySelector<HTMLElement>(`.mark[data-row="${index}"]`);
      if (!start) continue;
      const a = start.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      const x1 = Math.round(a.right - box.left + 4);
      const y1 = Math.round(a.top + a.height / 2 - box.top);
      const x2 = Math.round(c.left - box.left);
      const y2 = Math.round(c.top + Math.min(26, c.height / 2) - box.top);
      const mid = Math.round((x1 + x2) / 2);
      wires.push({
        index,
        x1,
        y1,
        x2,
        y2,
        d: `M${x1} ${y1} C${mid} ${y1} ${mid} ${y2} ${x2} ${y2}`,
      });
    }
    this.wires.set(wires);
  }

  protected identity(index: number): Identity | undefined {
    return this.identities().get(`${this.pageId}:${index}`);
  }

  protected cancel() {
    if (!this.run$) return;
    this.run$.abort();
    this.run$ = null;
    void this.client?.removeBatch();
    if (this.running()) this.phase.set('idle');
  }

  protected async run() {
    this.cancel();
    const sample = this.chosen();
    const abort = new AbortController();
    this.run$ = abort;
    // A throwaway batch, never the visitor's own saved one.
    const client = new JobClient(crypto.randomUUID());
    this.client = client;
    const documentId = crypto.randomUUID();
    this.pageId = `${documentId}:0`;
    this.readSample.set(sample);
    this.rows.set([]);
    this.records.set(null);
    this.error.set(null);
    this.sparkDone.set(false);
    this.phase.set('reading');
    try {
      const image = await dataUrl(sample.src, abort.signal);
      await client.submitPage({
        documentId,
        pageId: this.pageId,
        page: 0,
        revision: crypto.randomUUID(),
        image,
        sample: sample.sample,
      });
      const page = await this.until(client, abort.signal, (view) =>
        view.pages.find(
          (p) => p.pageId === this.pageId && p.state !== 'queued' && p.state !== 'running',
        ),
      );
      const result = (page as PageJobView).result;
      if (!result) throw new Error(`${this.spark()} couldn't read this page. Try again.`);
      this.sparkDone.set(true);
      this.rows.set(result.rows);

      this.phase.set('identifying');
      await client.submitNormalization({
        processingVersion: PROCESSING_VERSION,
        documents: [
          {
            id: documentId,
            name: 'Lab document',
            observations: result.observations,
            dates: result.dates,
          },
        ],
      });
      const normalization = await this.until(client, abort.signal, (view) =>
        view.normalization.state === 'done' || view.normalization.state === 'failed'
          ? view.normalization
          : undefined,
      );
      if (!normalization.result)
        throw new Error(`${this.wonder()} couldn't finish identifying the tests. Try again.`);
      this.records.set(normalization.result);
      this.phase.set('done');
    } catch (error) {
      if (abort.signal.aborted) return;
      this.error.set(
        error instanceof BusyError
          ? 'Many people are trying this right now. Wait a minute and try again.'
          : error instanceof Error
            ? error.message
            : 'Something went wrong. Try again.',
      );
      this.phase.set('error');
    } finally {
      if (this.run$ === abort) {
        this.run$ = null;
        // Results are shown; the server can forget the batch now.
        void client.removeBatch();
      }
    }
  }

  /** Long-poll the batch until `pick` finds what we wait for. */
  private async until<T>(
    client: JobClient,
    signal: AbortSignal,
    pick: (view: Awaited<ReturnType<JobClient['view']>>) => T | undefined,
  ): Promise<T> {
    let version = 0;
    for (;;) {
      const view = await client.view(version, MAX_WAIT_SECONDS, signal);
      const found = pick(view);
      if (found !== undefined) return found;
      version = view.version;
    }
  }
}

function modelLabel(id: string | undefined, fallback: string): string {
  const m = id && /^muse-(\w+)-([\d.]+)$/.exec(id);
  return m ? `Muse ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}` : fallback;
}

function identitiesOf(records: RecordsResponse | null): Map<string, Identity> {
  const out = new Map<string, Identity>();
  if (!records) return out;
  for (const domain of records.domains)
    for (const chart of domain.charts)
      for (const series of chart.series)
        for (const p of series.points)
          out.set(p.observationId, {
            status: 'charted',
            label: series.label,
            value: p.value,
            unit: series.unit,
            note: null,
          });
  for (const t of records.textResults)
    out.set(t.observationId, {
      status: 'text',
      label: t.label,
      value: null,
      unit: null,
      note: t.english,
    });
  for (const w of records.warnings)
    out.set(w.observationId, {
      status: 'held',
      label: null,
      value: null,
      unit: null,
      note: w.detail,
    });
  return out;
}

/** The sample as a JPEG data URL, the format an approved page is sent in. */
async function dataUrl(src: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error('The sample page could not be loaded.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The sample page could not be loaded.'));
    reader.readAsDataURL(blob);
  });
}

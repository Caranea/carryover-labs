import { DecimalPipe } from '@angular/common';
import { Component, computed, OnDestroy, OnInit, signal } from '@angular/core';
import type { PageJobView } from '@shared/jobs';
import { MAX_WAIT_SECONDS } from '@shared/jobs';
import { PROCESSING_VERSION, type PrintedRow } from '@shared/processing';
import type { RecordsResponse } from '@shared/records';
import { BusyError, JobClient } from '../core/job-client';
import { Icon } from '../ui/icon';

/** Fictional pages with their identifiers already blacked out, as an approved copy would be. */
interface LiveSample {
  key: string;
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
    src: 'samples/live/polish-thyroid.jpg',
    width: 1100,
    height: 1559,
    title: 'Polish PDF, 3 thyroid tests',
    detail: 'Quick: a short page',
    language: 'pl',
  },
  {
    key: 'german-cumulative',
    src: 'samples/live/german-cumulative.jpg',
    width: 1200,
    height: 1594,
    title: 'German phone photo, 28 tests',
    detail: 'Slower: a dense page',
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
interface Models {
  transcription: string;
  identification: string;
}

/**
 * The demo's one live path: an approved, fictional page goes through the same job API as a
 * user's page, Muse Spark reads it, then Muse Wonder identifies each printed test. Rows appear
 * as soon as Spark answers, so the wait for Wonder is spent looking at results.
 */
@Component({
  selector: 'app-live-read',
  imports: [Icon, DecimalPipe],
  template: `
    <section class="live rounded-box border border-base-300 p-5 sm:p-6" aria-labelledby="live-h">
      <div class="flex flex-col gap-1">
        <h2 id="live-h" class="font-display text-2xl font-semibold">Watch Meta's AI read a page</h2>
        <p class="text-base-content/80 max-w-3xl">
          The results above were prepared earlier. Here, one of Jane Doe's pages goes through the
          real pipeline now: <strong>{{ spark() }}</strong> transcribes it exactly as printed, then
          <strong>{{ wonder() }}</strong> works out which test each printed name is. Personal
          details are already blacked out, as they would be after your own review.
        </p>
      </div>

      @if (models() === null) {
        <p class="mt-4 text-sm">Live reading isn't switched on for this server.</p>
      } @else {
        <fieldset class="mt-4 flex flex-wrap gap-3" [disabled]="running()">
          <legend class="sr-only">Choose a page</legend>
          @for (s of samples; track s.key) {
            <label class="choice" [class.chosen]="chosen().key === s.key">
              <input
                type="radio"
                name="live-sample"
                class="radio radio-primary radio-sm"
                [checked]="chosen().key === s.key"
                (change)="choose(s)"
              />
              <img [src]="s.src" alt="" width="44" height="62" />
              <span class="flex flex-col">
                <span class="font-medium">{{ s.title }}</span>
                <span class="text-sm text-base-content/80">{{ s.detail }}</span>
              </span>
            </label>
          }
        </fieldset>
        <div class="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            class="btn btn-primary rounded-full"
            [disabled]="running()"
            (click)="run()"
          >
            <app-icon name="scan" size="1.1rem" />
            {{ phase() === 'done' || phase() === 'error' ? 'Read it again' : 'Read it live' }}
          </button>
          @if (running()) {
            <button type="button" class="btn btn-ghost rounded-full" (click)="cancel()">
              Stop
            </button>
          }
        </div>
      }

      <ol class="steps-live mt-5" aria-live="polite">
        @if (phase() !== 'idle') {
          <li [class.active]="phase() === 'reading'" [class.finished]="sparkSeconds() !== null">
            <strong>{{ spark() }}</strong> reads the page
            <span class="tabular-nums text-base-content/80">
              {{ sparkSeconds() ?? elapsed('reading') | number: '1.0-0' }} s
            </span>
            @if (rows().length) {
              <span class="text-base-content/80">· {{ rows().length }} rows</span>
            }
          </li>
        }
        @if (sparkSeconds() !== null) {
          <li [class.active]="phase() === 'identifying'" [class.finished]="phase() === 'done'">
            <strong>{{ wonder() }}</strong> identifies each test
            <span class="tabular-nums text-base-content/80">
              {{ wonderSeconds() ?? elapsed('identifying') | number: '1.0-0' }} s
            </span>
          </li>
        }
      </ol>
      @if (error(); as e) {
        <p role="alert" class="alert alert-error alert-soft mt-3">{{ e }}</p>
      }

      @if (rows().length) {
        <div class="live-result mt-5">
          <figure class="page">
            <div class="relative">
              <img
                [src]="readSample()!.src"
                class="block w-full rounded-box border border-base-300"
                [alt]="readSample()!.title + ', with the rows the model found outlined'"
              />
              <svg
                class="absolute inset-0 w-full h-full"
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                @for (r of rows(); track $index) {
                  @if (r.region; as b) {
                    <rect
                      [attr.x]="b[0]"
                      [attr.y]="b[1]"
                      [attr.width]="b[2]"
                      [attr.height]="b[3]"
                      [class.on]="focused() === $index"
                      vector-effect="non-scaling-stroke"
                    />
                  }
                }
              </svg>
            </div>
            <figcaption class="text-sm text-base-content/80 mt-2">
              Outlines are the regions {{ spark() }} returned for each row; every value in the app
              links back to one.
            </figcaption>
          </figure>
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <caption class="sr-only">
                What the models read and identified
              </caption>
              <thead>
                <tr>
                  <th scope="col">As printed</th>
                  <th scope="col">Value</th>
                  <th scope="col">Identified as</th>
                </tr>
              </thead>
              <tbody>
                @for (r of rows(); track $index) {
                  <tr
                    tabindex="0"
                    [class.on]="focused() === $index"
                    (mouseenter)="focused.set($index)"
                    (focus)="focused.set($index)"
                    (mouseleave)="focused.set(null)"
                    (blur)="focused.set(null)"
                  >
                    <th scope="row" class="font-normal" [attr.lang]="readSample()!.language">
                      {{ r.name ?? 'Unreadable' }}
                      @if (r.doubt) {
                        <span class="block text-xs text-warning-content"
                          >Hard to read: {{ r.doubt }}</span
                        >
                      }
                    </th>
                    <td class="whitespace-nowrap">
                      {{ r.value ?? '–' }} <span class="text-base-content/80">{{ r.unit }}</span>
                    </td>
                    <td>
                      @if (identity($index); as id) {
                        @if (id.status === 'held') {
                          <span class="text-base-content/80">Held for review: {{ id.note }}</span>
                        } @else {
                          <span class="font-medium">{{ id.label }}</span>
                          @if (id.value !== null) {
                            <span class="block text-xs text-base-content/80"
                              >{{ id.value | number: '1.0-3' }} {{ id.unit }}</span
                            >
                          }
                        }
                      } @else if (phase() === 'identifying') {
                        <span
                          class="loading loading-dots loading-xs"
                          aria-label="Identifying"
                        ></span>
                      } @else {
                        <span class="text-base-content/80">–</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }
    </section>
  `,
  styles: `
    .live {
      background: var(--color-base-100);
    }
    .choice {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 44px;
      padding: 0.6rem 0.9rem;
      border: 1px solid var(--color-base-300);
      border-radius: var(--radius-box);
      cursor: pointer;
    }
    .choice.chosen {
      border-color: var(--color-primary);
      background: color-mix(in oklab, var(--color-primary) 6%, #fff);
    }
    .choice img {
      width: 44px;
      height: 62px;
      object-fit: cover;
      object-position: top;
      border: 1px solid var(--color-base-300);
      border-radius: 4px;
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
    @media (prefers-reduced-motion: reduce) {
      .steps-live li.active::before {
        animation: none;
      }
    }
    .live-result {
      display: grid;
      gap: 1.25rem;
    }
    /* On a phone the rows come first; the tall page image follows them. */
    .page {
      order: 2;
    }
    @media (min-width: 56rem) {
      .live-result {
        grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
        align-items: start;
      }
      .page {
        order: 0;
        position: sticky;
        top: calc(var(--app-header-height) + 1rem);
      }
    }
    rect {
      fill: color-mix(in oklab, var(--color-accent) 22%, transparent);
      stroke: var(--color-primary);
      stroke-width: 1.5;
    }
    rect.on {
      fill: color-mix(in oklab, var(--color-accent) 60%, transparent);
      stroke-width: 3;
    }
    tr.on {
      background: color-mix(in oklab, var(--color-accent) 25%, #fff);
    }
    tr:focus-visible {
      outline-offset: -3px;
    }
  `,
})
export class LiveRead implements OnInit, OnDestroy {
  protected readonly samples = SAMPLES;
  protected readonly chosen = signal(SAMPLES[0]);
  protected readonly readSample = signal<LiveSample | null>(null);
  protected readonly models = signal<Models | null | undefined>(undefined);
  protected readonly phase = signal<Phase>('idle');
  protected readonly rows = signal<PrintedRow[]>([]);
  protected readonly records = signal<RecordsResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly focused = signal<number | null>(null);
  protected readonly sparkSeconds = signal<number | null>(null);
  protected readonly wonderSeconds = signal<number | null>(null);
  private readonly now = signal(performance.now());
  private readonly started: Partial<Record<Phase, number>> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
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

  async ngOnInit() {
    try {
      const response = await fetch('/api/demo/config');
      const body = (await response.json()) as { models?: Models | null };
      this.models.set(response.ok ? (body.models ?? null) : null);
    } catch {
      this.models.set(null);
    }
  }

  ngOnDestroy() {
    this.cancel();
  }

  protected choose(sample: LiveSample) {
    this.chosen.set(sample);
  }

  protected elapsed(phase: Phase): number {
    const start = this.started[phase];
    return start === undefined ? 0 : (this.now() - start) / 1000;
  }

  protected identity(index: number): Identity | undefined {
    return this.identities().get(`${this.pageId}:${index}`);
  }

  protected cancel() {
    if (!this.run$) return;
    this.run$.abort();
    this.run$ = null;
    void this.client?.removeBatch();
    this.stopTimer();
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
    this.sparkSeconds.set(null);
    this.wonderSeconds.set(null);
    this.begin('reading');
    try {
      const image = await dataUrl(sample.src, abort.signal);
      await client.submitPage({
        documentId,
        pageId: this.pageId,
        page: 0,
        revision: crypto.randomUUID(),
        image,
      });
      const page = await this.until(client, abort.signal, (view) =>
        view.pages.find(
          (p) => p.pageId === this.pageId && p.state !== 'queued' && p.state !== 'running',
        ),
      );
      const result = (page as PageJobView).result;
      if (!result) throw new Error(`${this.spark()} couldn't read this page. Try again.`);
      this.sparkSeconds.set(this.elapsed('reading'));
      this.rows.set(result.rows);

      this.begin('identifying');
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
      this.wonderSeconds.set(this.elapsed('identifying'));
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
        this.stopTimer();
        // Results are shown; the server can forget the batch now.
        void client.removeBatch();
      }
    }
  }

  private begin(phase: Phase) {
    this.started[phase] = performance.now();
    this.now.set(performance.now());
    this.phase.set(phase);
    this.timer ??= setInterval(() => this.now.set(performance.now()), 250);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
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

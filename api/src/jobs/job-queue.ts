import type { PageRequest, PageTranscription } from '../shared/processing.js';
import type { BatchView, JobState, NormalizationView, PageJobView } from '../shared/jobs.js';

export type { BatchView, JobState, NormalizationView, PageJobView };
import type { SourceDocument } from '../demo/normalization.js';

/** The work the queue runs. Both must stop early when the signal aborts. */
export interface JobRunner<R> {
  page(request: PageRequest, signal: AbortSignal): Promise<PageTranscription>;
  normalize(documents: SourceDocument[], signal: AbortSignal): Promise<R>;
}

export interface QueueLimits {
  /** Model calls running at once across all batches. */
  concurrency: number;
  pagesPerBatch: number;
  totalJobs: number;
  /** Bytes of page images waiting in memory. */
  queuedBytes: number;
  /** A batch with no client contact for this long is purged. */
  ttlMs: number;
}

export const DEFAULT_LIMITS: QueueLimits = {
  concurrency: 8,
  pagesPerBatch: 40,
  totalJobs: 200,
  queuedBytes: 300 * 1024 * 1024,
  ttlMs: 15 * 60 * 1000,
};

/** Rejected at submit time, so the client can wait and retry instead of failing mid-run. */
export class QueueFullError extends Error {}

const FAILED_PAGE = 'This page could not finish transcription. Please try again.';
const FAILED_BATCH = 'Results normalization did not finish. Please try again.';

interface Job<R> {
  batch: Batch<R>;
  state: JobState;
  abort: AbortController;
  queuedAt: number;
  bytes: number;
  start: (signal: AbortSignal) => Promise<unknown>;
  finish: (value: unknown) => void;
  error?: string;
}

interface PageJob<R> extends Job<R> {
  request: PageRequest;
  result?: PageTranscription;
}

interface NormalizationJob<R> extends Job<R> {
  result?: R;
}

interface Batch<R> {
  id: string;
  version: number;
  touchedAt: number;
  pages: Map<string, PageJob<R>>;
  normalization: NormalizationJob<R> | null;
  waiters: Set<() => void>;
}

/**
 * In-memory jobs for one API process. Nothing is written to disk: results stay until the
 * browser confirms it saved them, or until the batch expires.
 */
export class JobQueue<R> {
  private readonly batches = new Map<string, Batch<R>>();
  private running = 0;
  /** Round-robin cursor: the batch that most recently started a job. */
  private lastServed: string | null = null;

  constructor(
    private readonly runner: JobRunner<R>,
    private readonly limits: QueueLimits = DEFAULT_LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Queue a page. Resubmitting the same page and revision returns the existing job. */
  submitPage(batchId: string, request: PageRequest): PageJobView {
    const batch = this.batch(batchId, true)!;
    const existing = batch.pages.get(request.pageId);
    if (existing && existing.request.revision === request.revision && existing.state !== 'failed') {
      return pageView(existing);
    }
    if (existing) this.cancel(existing);
    else if (batch.pages.size >= this.limits.pagesPerBatch) {
      throw new QueueFullError(`Send at most ${this.limits.pagesPerBatch} pages at once.`);
    }
    if (
      this.activeJobs() >= this.limits.totalJobs ||
      this.waitingBytes() + request.image.length > this.limits.queuedBytes
    ) {
      throw new QueueFullError('Many pages are waiting. Try again shortly.');
    }
    const job: PageJob<R> = {
      ...this.newJob(batch, request.image.length),
      request,
      start: (signal) => this.runner.page(request, signal),
      finish: (value) => {
        job.result = value as PageTranscription;
      },
    };
    batch.pages.set(request.pageId, job);
    this.changed(batch);
    this.pump();
    return pageView(job);
  }

  /** Queue normalization for the batch, replacing any earlier request. */
  submitNormalization(batchId: string, documents: SourceDocument[]): NormalizationView<R> {
    const batch = this.batch(batchId, true)!;
    if (batch.normalization) this.cancel(batch.normalization);
    if (this.activeJobs() >= this.limits.totalJobs) {
      throw new QueueFullError('Many pages are waiting. Try again shortly.');
    }
    const job: NormalizationJob<R> = {
      ...this.newJob(batch, 0),
      start: (signal) => this.runner.normalize(documents, signal),
      finish: (value) => {
        job.result = value as R;
      },
    };
    batch.normalization = job;
    this.changed(batch);
    this.pump();
    return normalizationView(job);
  }

  /** The batch's jobs. An unknown or expired batch reads as empty: its pages can simply be sent again. */
  view(batchId: string): BatchView<R> {
    const batch = this.batch(batchId, false);
    if (!batch) return { version: 0, pages: [], normalization: { state: 'idle' } };
    return {
      version: batch.version,
      pages: [...batch.pages.values()].map(pageView),
      normalization: batch.normalization
        ? normalizationView(batch.normalization)
        : { state: 'idle' },
    };
  }

  /** Answer as soon as the batch changes after `since`, or after `timeoutMs` unchanged. */
  async wait(
    batchId: string,
    since: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<BatchView<R>> {
    const batch = this.batch(batchId, false);
    if (!batch || batch.version > since || timeoutMs <= 0) return this.view(batchId);
    await new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        batch.waiters.delete(done);
        signal?.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      batch.waiters.add(done);
      signal?.addEventListener('abort', done);
    });
    return this.view(batchId);
  }

  /** Confirm a saved page or cancel it. A different revision is left alone. */
  removePage(batchId: string, pageId: string, revision?: string): void {
    const batch = this.batch(batchId, false);
    const job = batch?.pages.get(pageId);
    if (!batch || !job || (revision && job.request.revision !== revision)) return;
    this.cancel(job);
    batch.pages.delete(pageId);
    this.changed(batch);
  }

  /** Cancel everything in the batch and forget it. */
  removeBatch(batchId: string): void {
    const batch = this.batches.get(batchId);
    if (!batch) return;
    for (const job of batch.pages.values()) this.cancel(job);
    if (batch.normalization) this.cancel(batch.normalization);
    this.batches.delete(batchId);
    for (const wake of batch.waiters) wake();
  }

  /** Purge batches nobody has asked about within the time limit. */
  sweep(): void {
    const cutoff = this.now() - this.limits.ttlMs;
    for (const batch of [...this.batches.values()]) {
      if (batch.touchedAt < cutoff) this.removeBatch(batch.id);
    }
  }

  private batch(batchId: string, create: boolean): Batch<R> | null {
    let batch = this.batches.get(batchId);
    if (!batch && create) {
      batch = {
        id: batchId,
        version: 0,
        touchedAt: 0,
        pages: new Map(),
        normalization: null,
        waiters: new Set(),
      };
      this.batches.set(batchId, batch);
    }
    if (batch) batch.touchedAt = this.now();
    return batch ?? null;
  }

  private newJob(batch: Batch<R>, bytes: number) {
    return {
      batch,
      state: 'queued' as JobState,
      abort: new AbortController(),
      queuedAt: this.now(),
      bytes,
    };
  }

  private cancel(job: Job<R>): void {
    if (job.state === 'queued' || job.state === 'running') job.abort.abort();
    job.state = 'failed';
    job.error = 'Cancelled.';
    release(job);
  }

  private changed(batch: Batch<R>): void {
    batch.version++;
    for (const wake of [...batch.waiters]) wake();
  }

  private jobs(): Job<R>[] {
    return [...this.batches.values()].flatMap((b) => [
      ...b.pages.values(),
      ...(b.normalization ? [b.normalization] : []),
    ]);
  }

  private activeJobs(): number {
    return this.jobs().filter((j) => j.state === 'queued' || j.state === 'running').length;
  }

  private waitingBytes(): number {
    return this.jobs().reduce(
      (n, j) => n + (j.state === 'queued' || j.state === 'running' ? j.bytes : 0),
      0,
    );
  }

  /** Start queued jobs while capacity allows, taking batches in turn. */
  private pump(): void {
    while (this.running < this.limits.concurrency) {
      const job = this.nextJob();
      if (!job) return;
      void this.execute(job);
    }
  }

  private nextJob(): Job<R> | null {
    const ids = [...this.batches.keys()];
    const start = this.lastServed ? ids.indexOf(this.lastServed) + 1 : 0;
    for (let i = 0; i < ids.length; i++) {
      const batch = this.batches.get(ids.at((start + i) % ids.length)!)!;
      const candidates = [
        ...batch.pages.values(),
        ...(batch.normalization ? [batch.normalization] : []),
      ];
      const next = candidates
        .filter((j) => j.state === 'queued')
        .sort((a, b) => a.queuedAt - b.queuedAt)[0];
      if (next) {
        this.lastServed = batch.id;
        return next;
      }
    }
    return null;
  }

  private async execute(job: Job<R>): Promise<void> {
    job.state = 'running';
    this.running++;
    this.changed(job.batch);
    try {
      const value = await job.start(job.abort.signal);
      if (job.abort.signal.aborted) return;
      job.finish(value);
      job.state = 'done';
    } catch {
      if (job.abort.signal.aborted) return;
      job.state = 'failed';
      // Never keep provider text: it can echo submitted content.
      job.error = job.batch.normalization === job ? FAILED_BATCH : FAILED_PAGE;
    } finally {
      // Done, failed or cancelled: the page image is never needed again (a retry sends it anew).
      release(job);
      this.running--;
      if (!job.abort.signal.aborted) this.changed(job.batch);
      this.pump();
    }
  }
}

function pageView<R>(job: PageJob<R>): PageJobView {
  return {
    pageId: job.request.pageId,
    revision: job.request.revision,
    state: job.state,
    ...(job.state === 'done' ? { result: job.result } : {}),
    ...(job.state === 'failed' ? { error: job.error } : {}),
  };
}

function normalizationView<R>(job: NormalizationJob<R>): NormalizationView<R> {
  return {
    state: job.state,
    ...(job.state === 'done' ? { result: job.result } : {}),
    ...(job.state === 'failed' ? { error: job.error } : {}),
  };
}

/** Drop a finished or failed page's image from memory. */
function release<R>(job: Job<R>): void {
  job.bytes = 0;
  if ('request' in job) {
    const page = job as PageJob<R>;
    if (page.request.image) page.request = { ...page.request, image: '' };
  }
}

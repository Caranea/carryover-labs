import { inject, Injectable, signal } from '@angular/core';
import { MAX_WAIT_SECONDS } from '@shared/jobs';
import { PROCESSING_VERSION } from '@shared/processing';
import type { RecordsResponse } from '@shared/records';
import { BusyError, JobClient, type RecordsView } from './job-client';
import { LocalHistory } from './local-history';

export interface ProcessingState {
  stage: 'idle' | 'transcribing' | 'waiting' | 'normalizing' | 'ready' | 'error';
  /** Pages saved with their transcription. */
  completed: number;
  total: number;
  /** Pages the server is reading right now, and pages waiting their turn. */
  running: number;
  queued: number;
  error: string | null;
}

const IDLE: ProcessingState = {
  stage: 'idle',
  completed: 0,
  total: 0,
  running: 0,
  queued: 0,
  error: null,
};
/** Consecutive connection failures tolerated (with backoff) before reporting an error. */
const MAX_CONNECTION_FAILURES = 6;
/**
 * Pages kept on the server at once; the next is sent as each result arrives. Twice the
 * server's default model concurrency keeps it busy without ever hitting its batch limit.
 */
const MAX_IN_FLIGHT = 16;

type Source = ReturnType<LocalHistory['recordSnapshot']>['sources'][number];
const key = (page: { pageId: string; revision: string }) => `${page.pageId}/${page.revision}`;

/**
 * Sends approved, redacted page images to Meta's models as jobs and keeps the results in
 * the local history. Requests return at once; results arrive through one long poll.
 */
@Injectable({ providedIn: 'root' })
export class ResultsService {
  private readonly history = inject(LocalHistory);
  private readonly jobs = new JobClient();

  readonly processing = signal<ProcessingState>(IDLE);
  private batchReady = true;
  private transcribing: Promise<void> | null = null;
  /** Ends the current long poll early, so a newly approved page is sent at once. */
  private nudge: AbortController | null = null;
  /** Pages the server is reading or will read: from the last view, plus pages sent since. */
  private onServer = new Set<string>();
  private check: { fingerprint: string; promise: Promise<RecordsResponse> } | null = null;
  /** Pages whose job failed; they are sent again only on an explicit retry. */
  private readonly failed = new Map<string, string>();
  /** Backoff after a dropped connection (overridable in tests). */
  protected retryDelay = (attempt: number) => Math.min(1000 * 2 ** attempt, 15_000);

  /** `ready` is false while documents still wait for privacy review: transcribe, but do not normalize. */
  prepareBatch(_queueBatchId: string, ready: boolean) {
    this.batchReady = ready;
    if (ready) void this.records().catch(() => {});
    else void this.transcribe().catch(() => {});
  }

  async records(retry = false): Promise<RecordsResponse> {
    const snapshot = this.history.recordSnapshot();
    if (!snapshot.documents.length) {
      this.check = null;
      this.processing.set(IDLE);
      return {
        domains: [],
        textResults: [],
        warnings: [],
        stats: { documents: 0, tests: 0, values: 0, from: null, to: null },
        model: { state: 'ready', name: null, waiting: 0, message: null },
      };
    }
    if (this.check?.fingerprint === snapshot.fingerprint) return this.check.promise;
    const cached = this.history.cachedModelRecords();
    if (cached?.model.state === 'ready' && !retry && this.batchReady && !snapshot.sources.length) {
      this.processing.update((p) => ({ ...p, stage: 'ready', error: null }));
      return cached;
    }
    const promise = this.transcribeAndNormalize(retry)
      .catch((error: Error) => {
        if (this.check?.promise === promise) {
          this.processing.update((p) => ({ ...p, stage: 'error', error: error.message }));
        }
        throw error;
      })
      .finally(() => {
        if (this.check?.promise === promise) this.check = null;
      });
    this.check = { fingerprint: snapshot.fingerprint, promise };
    return promise;
  }

  retryRecords() {
    return this.records(true);
  }

  private async transcribeAndNormalize(retry: boolean): Promise<RecordsResponse> {
    await this.transcribe(retry);
    if (!this.batchReady) {
      throw new Error(
        'Finish preparing and approving or removing the remaining documents before normalization.',
      );
    }
    const processed = this.history.recordSnapshot();
    if (processed.sources.length)
      throw new Error('Some pages still need transcription. Please retry.');
    const started = performance.now();
    this.processing.update((p) => ({ ...p, stage: 'normalizing', error: null }));
    const current = () =>
      this.batchReady && this.history.recordSnapshot().fingerprint === processed.fingerprint;

    const result = await this.normalize(processed.documents, current);
    if (result.model?.state !== 'ready')
      throw new Error('Results normalization did not finish. Please try again.');
    if (!current() || !this.history.saveModelRecords(processed.fingerprint, result)) {
      throw new Error('The batch changed. Finish reviewing it and try again.');
    }
    console.info('[Carryover timing]', {
      stage: 'normalization',
      elapsedMs: Math.round(performance.now() - started),
      documents: processed.documents.length,
    });
    this.processing.update((p) => ({ ...p, stage: 'ready', error: null }));
    return result;
  }

  /** Send every unsaved page and collect results until each is saved or has failed. */
  private transcribe(retry = false): Promise<void> {
    if (retry) this.failed.clear();
    // Already collecting: a newly approved page interrupts the wait so it is sent at once.
    if (this.transcribing && this.unsent().length && this.onServer.size < MAX_IN_FLIGHT)
      this.nudge?.abort();
    this.transcribing ??= this.collectPages().finally(() => {
      this.transcribing = null;
      this.nudge = null;
    });
    return this.transcribing;
  }

  /** Approved pages that are not saved yet and have not failed. */
  private waiting(): Source[] {
    return this.history.recordSnapshot().sources.filter((source) => !this.failed.has(key(source)));
  }

  private unsent(): Source[] {
    return this.waiting().filter((source) => !this.onServer.has(key(source)));
  }

  private async collectPages(): Promise<void> {
    let view: RecordsView | undefined;
    let connectionFailures = 0;
    this.onServer = new Set();
    // Nothing approved and unsaved: the server has nothing for us, so do not ask it.
    while (this.waiting().length) {
      const nudge = (this.nudge = new AbortController());
      let fresh: RecordsView | undefined;
      try {
        // Asking from version 0 answers at once, so a refresh sees what the server already holds.
        fresh = await this.jobs.view(view?.version ?? 0, MAX_WAIT_SECONDS, nudge.signal);
        connectionFailures = 0;
      } catch {
        if (!nudge.signal.aborted) {
          // A locked phone or a dropped connection: back off and try again.
          if (++connectionFailures > MAX_CONNECTION_FAILURES) {
            throw new Error(
              'The connection was lost while reading your pages. Check your connection and retry.',
            );
          }
          await pause(this.retryDelay(connectionFailures));
          continue;
        }
      }
      if (fresh) {
        view = fresh;
        this.onServer = await this.takeResults(view);
      }
      const room = MAX_IN_FLIGHT - this.onServer.size;
      const busy = await this.submit(this.unsent().slice(0, Math.max(room, 0)));
      await this.report(view, this.history.recordSnapshot().sources);
      // The server's queue is full: give it a moment before offering the pages again.
      if (busy) await pause(this.retryDelay(2));
    }
    const remaining = this.history.recordSnapshot().sources.length;
    if (remaining) {
      const reason =
        [...this.failed.values()][0] ??
        'Some pages still need transcription. Retry or remove the document.';
      throw new Error(reason);
    }
    this.processing.update((p) => ({
      ...p,
      stage: this.batchReady ? 'transcribing' : 'waiting',
      running: 0,
      queued: 0,
    }));
  }

  /**
   * Save finished pages, then tell the server to forget them. Jobs for pages that were
   * deleted or re-redacted meanwhile are cancelled. Returns the jobs still in progress.
   */
  private async takeResults(view: RecordsView): Promise<Set<string>> {
    const held = new Set<string>();
    const sources = new Map(this.history.recordSnapshot().sources.map((s) => [key(s), s]));
    for (const job of view.pages) {
      const source = sources.get(key(job));
      if (source && (job.state === 'queued' || job.state === 'running')) {
        held.add(key(job));
        continue;
      }
      if (source && job.state === 'done' && job.result) {
        try {
          this.history.savePageProcessing(source.documentId, source.revision, job.result);
        } catch (error) {
          this.failed.set(key(job), error instanceof Error ? error.message : String(error));
        }
      }
      if (source && job.state === 'failed')
        this.failed.set(key(job), job.error ?? 'This page could not be read.');
      await this.jobs.removePage(job.pageId, job.revision);
    }
    return held;
  }

  /** Queue pages the server does not have yet. Returns true when the server's queue was full. */
  private async submit(sources: Source[]): Promise<boolean> {
    for (const source of sources) {
      if (!this.history.pageSourceCurrent(source.documentId, source.revision, source.page))
        continue;
      try {
        // Only persisted, approved images are eligible. No manifests, filenames or OCR words leave here.
        const image = await imageDataUrl(
          await this.history.pageImage(source.documentId, source.page),
        );
        await this.jobs.submitPage({
          documentId: source.documentId,
          pageId: source.pageId,
          page: source.page,
          revision: source.revision,
          image,
        });
        this.onServer.add(key(source));
      } catch (error) {
        if (error instanceof BusyError) return true;
        this.failed.set(key(source), error instanceof Error ? error.message : String(error));
      }
    }
    return false;
  }

  private async report(view: RecordsView | undefined, remaining: Source[]) {
    const total = (await this.history.list()).reduce((n, d) => n + d.pageCount, 0);
    const current = new Set(remaining.map(key));
    const pages = (view?.pages ?? []).filter((p) => current.has(key(p)));
    this.processing.set({
      stage: 'transcribing',
      total,
      completed: total - remaining.length,
      running: pages.filter((p) => p.state === 'running').length,
      queued: pages.filter((p) => p.state === 'queued').length,
      error: null,
    });
  }

  /** Queue normalization and wait for it; the batch is forgotten on the server afterwards. */
  private async normalize(documents: unknown[], current: () => boolean): Promise<RecordsResponse> {
    let connectionFailures = 0;
    for (;;) {
      try {
        await this.jobs.submitNormalization({ processingVersion: PROCESSING_VERSION, documents });
        break;
      } catch (error) {
        if (!(error instanceof BusyError) || ++connectionFailures > MAX_CONNECTION_FAILURES)
          throw error;
        await pause(this.retryDelay(connectionFailures));
      }
    }
    let version = 0;
    connectionFailures = 0;
    for (;;) {
      if (!current()) throw new Error('The batch changed. Finish reviewing it and try again.');
      let view: RecordsView;
      try {
        view = await this.jobs.view(version, MAX_WAIT_SECONDS);
        connectionFailures = 0;
      } catch {
        if (++connectionFailures > MAX_CONNECTION_FAILURES) {
          throw new Error(
            'The connection was lost while organizing your results. Check your connection and retry.',
          );
        }
        await pause(this.retryDelay(connectionFailures));
        continue;
      }
      version = view.version;
      const job = view.normalization;
      if (job.state === 'done' && job.result) {
        await this.jobs.removeBatch();
        return job.result;
      }
      if (job.state === 'failed' || job.state === 'idle') {
        throw new Error(job.error ?? 'Results normalization did not finish. Please try again.');
      }
    }
  }
}

/** Wait, but wake early when the tab becomes visible again (a phone was unlocked). */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      resolve();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') done();
    };
    const timer = setTimeout(done, ms);
    document.addEventListener('visibilitychange', onVisible);
  });
}

function imageDataUrl(blob: Blob): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(blob.type)) {
    throw new Error('This saved source needs a redacted page image. Open it for review.');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The saved page could not be read.'));
    reader.readAsDataURL(blob);
  });
}

/** One plain sentence about page reading, for the Documents and Results pages. */
export function progressText(state: ProcessingState): string {
  if (!state.total) return 'Preparing your results…';
  const parts = [
    `${state.completed} of ${state.total} ${state.total === 1 ? 'page' : 'pages'} read`,
  ];
  if (state.running) parts.push(`${state.running} being read now`);
  if (state.queued) parts.push(`${state.queued} waiting`);
  return `${parts.join(', ')}.`;
}

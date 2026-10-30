import { Injectable, signal } from '@angular/core';
import { ASSETS, assetUrl } from '../core/assets';
import { WorkingPage } from '../core/models';
import { PagePredictions } from './detect';
import { NER_MODEL_ID, NerRequest, NerResponse } from './ner-protocol';
import { DetectorTiming } from './device-performance';
import type { DetectorVariant } from './model-selection';

export type NerState = 'idle' | 'loading' | 'ready' | 'unavailable';
export type NerPhase = 'idle' | 'preparing' | 'downloading' | 'starting' | 'checking' | 'complete' | 'failed';
/** Allow a slow download to continue while bytes arrive, with an overall bound. */
export const LOAD_TIMEOUT_MS = 120_000;
// FP16 may take tens of minutes on a slow connection. Keep the two-minute
// no-progress timeout, but do not abort an active download after ten minutes.
export const MAX_LOAD_TIME_MS = 60 * 60_000;
export const PREDICT_TIMEOUT_MS = 45_000;

interface Pending {
  resolve: (p: [string, number][]) => void;
  reject: (e: Error) => void;
  cleanup: () => void;
}

@Injectable({ providedIn: 'root' })
export class NerService {
  readonly state = signal<NerState>('idle');
  readonly phase = signal<NerPhase>('idle');
  readonly activityId = signal(0);
  readonly progress = signal(0);
  readonly downloadedBytes = signal(0);
  readonly totalBytes = signal(0);
  readonly pageNumber = signal(0);
  readonly pageCount = signal(0);
  readonly checkProgress = signal(0);
  readonly remainingSeconds = signal<number | null>(null);
  readonly lastProgressAt = signal(0);
  readonly error = signal<string | null>(null);
  /** Anonymous timings stay in memory for this session; no document text is retained. */
  readonly timings = signal<DetectorTiming[]>([]);
  readonly variant = signal<DetectorVariant | null>(null);
  readonly modelCached = signal(false);
  private predictionTask: Promise<PagePredictions[]> | null = null;
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private finishLoad: ((ok: boolean) => void) | null = null;
  private heartbeat: (() => void) | null = null;
  private generation = 0;
  private nextId = 0;
  private pending = new Map<number, Pending>();
  private downloadSample: { at: number; bytes: number } | null = null;
  private checkStartedAt = 0;
  private preferCpu = false;

  retry() {
    if (this.state() !== 'unavailable') return;
    this.ready = null;
    this.error.set(null);
    this.progress.set(0);
    this.phase.set('idle');
    this.state.set('idle');
  }

  /** Switching modes is a choice, not a detector failure. Settle work immediately. */
  cancel() {
    this.stopWorker();
    this.ready = null;
    this.error.set(null);
    this.remainingSeconds.set(null);
    this.phase.set('idle');
    this.state.set('idle');
  }

  load(): Promise<boolean> {
    if (this.ready) return this.ready;
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      this.fail('This browser cannot run the full privacy check. Choose manual review and hide personal details yourself.');
      return Promise.resolve(false);
    }
    this.state.set('loading');
    this.phase.set('preparing');
    this.progress.set(0);
    this.downloadedBytes.set(0);
    this.totalBytes.set(0);
    this.remainingSeconds.set(null);
    this.downloadSample = null;
    this.lastProgressAt.set(Date.now());
    this.ready = new Promise<boolean>((resolve) => {
      const stalled = () => this.fail(this.phase() === 'starting'
        ? 'Your device is taking too long to start the full privacy checker. Try again or switch to manual review, which needs less memory.'
        : 'The privacy checker download stopped making progress. Check your internet connection and retry, or switch to manual review.');
      let timer = setTimeout(stalled, LOAD_TIMEOUT_MS);
      const maximum = setTimeout(() => this.fail('Setup is taking too long on this device. You can retry or continue with manual review.'), MAX_LOAD_TIME_MS);
      this.heartbeat = () => { clearTimeout(timer); timer = setTimeout(stalled, LOAD_TIMEOUT_MS); };
      this.finishLoad = (ok) => {
        clearTimeout(timer); clearTimeout(maximum);
        this.finishLoad = null; this.heartbeat = null; resolve(ok);
      };
      try {
        const startWorker = (forceCpu: boolean) => {
        const worker = this.worker = new Worker(new URL('./ner.worker', import.meta.url), { type: 'module' });
        worker.onmessage = ({ data }: MessageEvent<NerResponse>) => {
          if (this.worker !== worker) return;
          switch (data.type) {
            case 'backend':
              if (this.variant() !== data.variant) this.timings.set([]);
              this.variant.set(data.variant);
              this.modelCached.set(!!data.cached);
              this.downloadedBytes.set(0); this.totalBytes.set(0); this.progress.set(0);
              this.downloadSample = null;
              this.lastProgressAt.set(Date.now()); this.heartbeat?.();
              break;
            case 'load-stage':
              this.phase.set(data.stage); this.remainingSeconds.set(null);
              this.lastProgressAt.set(Date.now()); this.heartbeat?.();
              break;
            case 'progress': this.downloadProgress(data); break;
            case 'gpu-load-error':
              if (forceCpu) { this.fail('The privacy checker could not start. Please retry.'); break; }
              this.preferCpu = true;
              worker.terminate(); this.worker = null;
              try { startWorker(true); }
              catch { this.fail('The privacy checker could not restart. Please retry.'); }
              break;
            case 'ready':
              this.progress.set(1); this.state.set('ready');
              this.phase.set('complete'); this.remainingSeconds.set(null);
              this.finishLoad?.(true);
              break;
            case 'predict-progress':
              if (this.pending.has(data.id) && data.total > 0) {
                const fraction = (this.pageNumber() - 1 + data.completed / data.total) / this.pageCount();
                this.checkProgress.set(Math.min(1, fraction));
                this.lastProgressAt.set(Date.now());
                const elapsed = (Date.now() - this.checkStartedAt) / 1000;
                this.remainingSeconds.set(elapsed >= 2 && fraction > 0 && fraction < 1 ? elapsed * (1 - fraction) / fraction : null);
              }
              break;
            case 'load-error':
              this.fail('The full privacy checker could not be downloaded or started. Check your connection and try again. On a phone with limited memory, choose manual review.');
              break;
            case 'result': {
              const p = this.pending.get(data.id);
              p?.cleanup(); p?.resolve(data.predictions); this.pending.delete(data.id);
              break;
            }
            case 'predict-error':
              if (this.variant() === 'gpu-fp16') this.preferCpu = true;
              this.fail('The full privacy check stopped before it finished. Retry it, or switch to manual review and review every page yourself.'); break;
          }
        };
        worker.onerror = () => {
          if (this.worker === worker) this.fail('The full privacy checker stopped unexpectedly. Your browser may have run out of memory. You can retry or switch to manual review.');
        };
        this.send({ type: 'load', modelId: NER_MODEL_ID, wasmBase: assetUrl(ASSETS.ortWasm), gpuModelBase: assetUrl(ASSETS.piiGpuModel), forceCpu });
        };
        startWorker(this.preferCpu);
      } catch {
        this.fail('The full privacy checker could not start on this device. Try again or switch to manual review.');
      }
    });
    return this.ready;
  }

  async predict(pages: WorkingPage[], signal?: AbortSignal): Promise<PagePredictions[]> {
    // The worker and its progress signals describe one check at a time.
    while (this.predictionTask) await this.predictionTask;
    if (signal?.aborted) return pages.map(() => null);
    const task = this.predictPages(pages, signal);
    this.predictionTask = task;
    try { return await task; }
    finally { if (this.predictionTask === task) this.predictionTask = null; }
  }

  private async predictPages(pages: WorkingPage[], signal?: AbortSignal): Promise<PagePredictions[]> {
    if (signal?.aborted) return pages.map(() => null);
    const generation = this.generation;
    this.activityId.update((id) => id + 1);
    this.pageCount.set(pages.length); this.pageNumber.set(0); this.checkProgress.set(0);
    const abort = () => this.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (!(await this.load()) || signal?.aborted || generation !== this.generation) return pages.map(() => null);
      this.phase.set('checking'); this.remainingSeconds.set(null);
      this.checkStartedAt = Date.now(); this.lastProgressAt.set(Date.now());
      const results: PagePredictions[] = [];
      for (let index = 0; index < pages.length; index++) {
        const page = pages[index];
        this.pageNumber.set(index + 1);
        const words = page.words.filter((w) => w.text !== null);
        if (!words.length) { results.push(new Map()); continue; }
        if (signal?.aborted || generation !== this.generation || this.state() !== 'ready') { results.push(null); continue; }
        const lines: string[][] = [];
        let current = -1;
        for (const w of words) {
          if (w.line !== current) { lines.push([]); current = w.line; }
          lines[lines.length - 1].push(w.text as string);
        }
        try {
          const startedAt = performance.now();
          const flat = await this.request(lines);
          if (signal?.aborted || generation !== this.generation) { results.push(null); continue; }
          if (flat.length !== words.length || flat.some((p) => !Array.isArray(p) || typeof p[0] !== 'string' || !Number.isFinite(p[1]) || p[1] < 0 || p[1] > 1)) throw new Error('Incomplete prediction');
          const milliseconds = performance.now() - startedAt;
          if (words.length >= 100 && milliseconds > 0) this.timings.update(samples => [...samples.slice(-5), { words: words.length, milliseconds }]);
          results.push(new Map(words.map((w, i) => [w.id, { label: flat[i][0], score: flat[i][1] }])));
          this.checkProgress.set((index + 1) / pages.length);
        } catch {
          if (!signal?.aborted && generation === this.generation) this.fail('The full privacy check could not finish this page. Retry it, or switch to manual review and inspect every page yourself.');
          results.push(null);
        }
      }
      if (generation === this.generation && !signal?.aborted) { this.phase.set('complete'); this.remainingSeconds.set(null); }
      return results;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  private downloadProgress(data: Extract<NerResponse, { type: 'progress' }>) {
    if (!Number.isFinite(data.loaded) || !Number.isFinite(data.total) || data.total <= 0) return;
    const now = Date.now();
    if (data.loaded > this.downloadedBytes()) { this.lastProgressAt.set(now); this.heartbeat?.(); }
    this.phase.set('downloading');
    this.downloadedBytes.set(data.loaded); this.totalBytes.set(data.total);
    this.progress.set(Math.max(0, Math.min(1, data.fraction)));
    this.downloadSample ??= { at: now, bytes: data.loaded };
    const elapsed = (now - this.downloadSample.at) / 1000;
    const bytes = data.loaded - this.downloadSample.bytes;
    this.remainingSeconds.set(elapsed >= 2 && bytes > 0 && data.loaded < data.total ? (data.total - data.loaded) / (bytes / elapsed) : null);
  }

  private request(lines: string[][]): Promise<[string, number][]> {
    if (!this.worker || this.state() !== 'ready') return Promise.reject(new Error('Detector unavailable'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('Checking this page is taking too long. Choose manual review, then inspect the personal details yourself.'), PREDICT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, cleanup: () => clearTimeout(timer) });
      this.send({ type: 'predict', id, lines });
    });
  }

  private send(msg: NerRequest) { this.worker?.postMessage(msg); }

  private stopWorker() {
    this.generation++;
    this.finishLoad?.(false);
    this.worker?.terminate(); this.worker = null;
    for (const p of this.pending.values()) { p.cleanup(); p.reject(new Error('Privacy check stopped')); }
    this.pending.clear();
  }

  private fail(message: string) {
    this.stopWorker();
    this.state.set('unavailable'); this.phase.set('failed'); this.error.set(message);
    this.remainingSeconds.set(null);
    this.ready = Promise.resolve(false);
  }
}

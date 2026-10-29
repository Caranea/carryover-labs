import { Injectable, signal } from '@angular/core';
import { ASSETS, assetUrl } from '../core/assets';
import { WorkingPage } from '../core/models';
import { PagePredictions } from './detect';
import { NER_MODEL_ID, NerRequest, NerResponse } from './ner-protocol';

export type NerState = 'idle' | 'loading' | 'ready' | 'unavailable';
export const LOAD_TIMEOUT_MS = 120_000;
export const PREDICT_TIMEOUT_MS = 45_000;

interface Pending {
  resolve: (p: [string, number][]) => void;
  reject: (e: Error) => void;
  cleanup: () => void;
}

/** Local detection is bounded. Every failed page is returned as null for its own warning. */
@Injectable({ providedIn: 'root' })
export class NerService {
  readonly state = signal<NerState>('idle');
  readonly progress = signal(0);
  readonly error = signal<string | null>(null);
  private worker: Worker | null = null;
  private ready: Promise<boolean> | null = null;
  private finishLoad: ((ok: boolean) => void) | null = null;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  /** Retry only on an explicit user action, avoiding repeated large downloads. */
  retry() {
    if (this.state() !== 'unavailable') return;
    this.ready = null;
    this.error.set(null);
    this.progress.set(0);
    this.state.set('idle');
  }

  load(): Promise<boolean> {
    if (this.ready) return this.ready;
    if (typeof Worker === 'undefined') {
      this.fail('This browser cannot run the automatic privacy check.');
      return Promise.resolve(false);
    }
    this.state.set('loading');
    this.ready = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => this.fail('The privacy detector took too long to load.'), LOAD_TIMEOUT_MS);
      this.finishLoad = (ok) => { clearTimeout(timer); this.finishLoad = null; resolve(ok); };
      try {
        this.worker = new Worker(new URL('./ner.worker', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }: MessageEvent<NerResponse>) => {
          switch (data.type) {
            case 'progress': this.progress.set(data.fraction); break;
            case 'ready':
              this.progress.set(1);
              this.state.set('ready');
              this.finishLoad?.(true);
              break;
            case 'load-error': this.fail('The automatic privacy detector could not be loaded.'); break;
            case 'result': {
              const p = this.pending.get(data.id);
              p?.cleanup();
              p?.resolve(data.predictions);
              this.pending.delete(data.id);
              break;
            }
            case 'predict-error': this.fail('The automatic privacy check could not finish.'); break;
          }
        };
        this.worker.onerror = () => this.fail('The automatic privacy detector stopped unexpectedly.');
        this.send({ type: 'load', modelId: NER_MODEL_ID, wasmBase: assetUrl(ASSETS.ortWasm) });
      } catch {
        this.fail('The automatic privacy detector could not start.');
      }
    });
    return this.ready;
  }

  async predict(pages: WorkingPage[], signal?: AbortSignal): Promise<PagePredictions[]> {
    if (signal?.aborted) return pages.map(() => null);
    const abort = () => this.fail('The automatic privacy check was cancelled.');
    signal?.addEventListener('abort', abort, { once: true });
    try {
      if (!(await this.load()) || signal?.aborted) return pages.map(() => null);
      const results: PagePredictions[] = [];
      for (const page of pages) {
        const words = page.words.filter((w) => w.text !== null);
        if (!words.length) { results.push(new Map()); continue; }
        if (signal?.aborted || this.state() !== 'ready') { results.push(null); continue; }
        const lines: string[][] = [];
        let current = -1;
        for (const w of words) {
          if (w.line !== current) { lines.push([]); current = w.line; }
          lines[lines.length - 1].push(w.text as string);
        }
        try {
          const flat = await this.request(lines);
          if (flat.length !== words.length || flat.some((p) => !Array.isArray(p) || typeof p[0] !== 'string' || !Number.isFinite(p[1]) || p[1] < 0 || p[1] > 1)) {
            throw new Error('Incomplete prediction');
          }
          results.push(new Map(words.map((w, i) => [w.id, { label: flat[i][0], score: flat[i][1] }])));
        } catch {
          this.fail('The automatic privacy check could not finish.');
          results.push(null);
        }
      }
      return results;
    } finally {
      signal?.removeEventListener('abort', abort);
    }
  }

  private request(lines: string[][]): Promise<[string, number][]> {
    if (!this.worker || this.state() !== 'ready') return Promise.reject(new Error('Detector unavailable'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail('The automatic privacy check took too long.'), PREDICT_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, cleanup: () => clearTimeout(timer) });
      this.send({ type: 'predict', id, lines });
    });
  }

  private send(msg: NerRequest) { this.worker?.postMessage(msg); }

  private fail(message: string) {
    this.state.set('unavailable');
    this.error.set(message);
    this.finishLoad?.(false);
    this.worker?.terminate();
    this.worker = null;
    this.ready = Promise.resolve(false);
    for (const p of this.pending.values()) { p.cleanup(); p.reject(new Error(message)); }
    this.pending.clear();
  }
}

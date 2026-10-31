import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkingPage } from '../core/models';
import { LOAD_TIMEOUT_MS, NerService, PREDICT_TIMEOUT_MS } from './ner.service';
import type { NerRequest, NerResponse } from './ner-protocol';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent<NerResponse>) => void) | null = null;
  onerror: (() => void) | null = null;
  requests: NerRequest[] = [];
  terminated = false;
  constructor() {
    FakeWorker.latest = this;
  }
  postMessage(request: NerRequest) {
    this.requests.push(request);
  }
  terminate() {
    this.terminated = true;
  }
  respond(data: NerResponse) {
    this.onmessage?.({ data } as MessageEvent<NerResponse>);
  }
}
const pages = (): WorkingPage[] => [
  {
    index: 0,
    width: 0,
    height: 0,
    image: null,
    imageUrl: null,
    ocr: false,
    regions: [],
    words: [{ id: 1, text: 'Synthetic', line: 0, hidden: false }],
  },
];

describe('bounded local privacy detection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('restarts in a fresh CPU worker after GPU setup fails', async () => {
    const service = new NerService();
    const loading = service.load();
    const gpu = FakeWorker.latest;
    gpu.respond({ type: 'backend', variant: 'gpu-fp16' });
    gpu.respond({ type: 'gpu-load-error', message: 'GPU session failed' });
    const cpu = FakeWorker.latest;
    expect(cpu).not.toBe(gpu);
    expect(gpu.terminated).toBe(true);
    expect(cpu.requests[0]).toMatchObject({ type: 'load', forceCpu: true });
    gpu.respond({ type: 'ready' });
    expect(service.state()).toBe('loading');
    cpu.respond({ type: 'backend', variant: 'cpu-q8' });
    cpu.respond({ type: 'ready' });
    expect(await loading).toBe(true);
    expect(service.variant()).toBe('cpu-q8');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses actual download speed for estimates and stops cleanly when the user switches modes', async () => {
    const service = new NerService();
    const prediction = service.predict(pages());
    const worker = FakeWorker.latest;
    worker.respond({ type: 'load-stage', stage: 'downloading' });
    worker.respond({ type: 'progress', fraction: 0.1, loaded: 10, total: 100 });
    expect(service.remainingSeconds()).toBeNull();
    await vi.advanceTimersByTimeAsync(4000);
    worker.respond({ type: 'progress', fraction: 0.3, loaded: 30, total: 100 });
    expect(service.remainingSeconds()).toBe(14);
    worker.respond({ type: 'load-stage', stage: 'starting' });
    expect(service.phase()).toBe('starting');
    expect(service.remainingSeconds()).toBeNull();
    service.cancel();
    expect(await prediction).toEqual([null]);
    worker.respond({ type: 'ready' });
    expect(service.state()).toBe('idle');
    expect(service.error()).toBeNull();
    expect(worker.terminated).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('lets an actively progressing download continue past the idle timeout', async () => {
    const service = new NerService();
    const loading = service.load();
    await vi.advanceTimersByTimeAsync(100_000);
    FakeWorker.latest.respond({ type: 'progress', fraction: 0.1, loaded: 10, total: 100 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(service.state()).toBe('loading');
    FakeWorker.latest.respond({ type: 'ready' });
    expect(await loading).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tracks page checking separately from the download and clears estimates on completion', async () => {
    const service = new NerService();
    const prediction = service.predict(pages());
    FakeWorker.latest.respond({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(4000);
    FakeWorker.latest.respond({ type: 'predict-progress', id: 0, completed: 1, total: 2 });
    expect(service.phase()).toBe('checking');
    expect(service.pageNumber()).toBe(1);
    expect(service.checkProgress()).toBe(0.5);
    expect(service.remainingSeconds()).toBe(4);
    FakeWorker.latest.respond({ type: 'result', id: 0, predictions: [['O', 1]] });
    await prediction;
    expect(service.phase()).toBe('complete');
    expect(service.remainingSeconds()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('settles a silent model load and allows an explicit retry', async () => {
    const service = new NerService();
    const load = service.load();
    await vi.advanceTimersByTimeAsync(LOAD_TIMEOUT_MS);
    expect(await load).toBe(false);
    expect(FakeWorker.latest.terminated).toBe(true);
    service.retry();
    const retried = service.load();
    FakeWorker.latest.respond({ type: 'ready' });
    expect(await retried).toBe(true);
  });

  it('settles silent inference, marks the page incomplete, and cannot hang the next document', async () => {
    const service = new NerService();
    const prediction = service.predict(pages());
    FakeWorker.latest.respond({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(PREDICT_TIMEOUT_MS);
    expect(await prediction).toEqual([null]);
    expect(service.state()).toBe('unavailable');
    expect(await service.predict(pages())).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves completed pages and reports only unfinished pages after a worker failure', async () => {
    const service = new NerService();
    const prediction = service.predict([...pages(), ...pages()]);
    FakeWorker.latest.respond({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    FakeWorker.latest.respond({ type: 'result', id: 0, predictions: [['O', 1]] });
    await vi.advanceTimersByTimeAsync(0);
    FakeWorker.latest.onerror?.();
    const result = await prediction;
    expect(result[0]?.get(1)?.label).toBe('O');
    expect(result[1]).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects incomplete prediction arrays and cancels a removed document without waiting for a timeout', async () => {
    const service = new NerService();
    const prediction = service.predict(pages());
    FakeWorker.latest.respond({ type: 'ready' });
    await vi.advanceTimersByTimeAsync(0);
    FakeWorker.latest.respond({ type: 'result', id: 0, predictions: [] });
    expect(await prediction).toEqual([null]);
    service.retry();
    const abort = new AbortController();
    const cancelled = service.predict(pages(), abort.signal);
    abort.abort();
    expect(await cancelled).toEqual([null]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

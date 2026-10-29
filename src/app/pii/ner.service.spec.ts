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
  constructor() { FakeWorker.latest = this; }
  postMessage(request: NerRequest) { this.requests.push(request); }
  terminate() { this.terminated = true; }
  respond(data: NerResponse) { this.onmessage?.({ data } as MessageEvent<NerResponse>); }
}
const pages = (): WorkingPage[] => [{ index: 0, width: 0, height: 0, image: null, imageUrl: null, ocr: false, regions: [], words: [
  { id: 1, text: 'Synthetic', line: 0, hidden: false },
] }];

describe('bounded local privacy detection', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('Worker', FakeWorker); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

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

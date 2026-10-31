import { settled } from '../../testing/settled';
import 'fake-indexeddb/auto';
import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { PageJobView } from '@shared/jobs';
import { ResultsService } from './results.service';
import { LOCAL_HISTORY_KEY, LocalHistory } from './local-history';
import type { DocumentManifest } from './models';
import { processedFixture, recordsFixture } from './processing-test-fixture';
import { deviceTransaction } from './device-storage';

type Outcome = 'done' | 'failed' | 'hold';
interface FakePage extends PageJobView {
  body: Record<string, unknown>;
}

/** An in-memory stand-in for the batch job API, answering like the real server. */
class FakeJobServer {
  pages = new Map<string, FakePage>();
  normalization: { state: string; result?: unknown; error?: string } = { state: 'idle' };
  version = 0;
  exists = false;
  /** Every request as "METHOD /path". */
  log: string[] = [];
  submitted: Record<string, unknown>[] = [];
  normalizations: Record<string, unknown>[] = [];
  pageOutcome: (body: Record<string, unknown>) => Outcome | 'busy' = () => 'done';
  normalizeOutcome: Outcome = 'done';
  /** How long an unanswered long poll waits (the real server waits up to 25 s). */
  pollMs = 30;
  private waiters: (() => void)[] = [];

  readonly fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const path = url.replace(/^\/api\/demo\/batches\/[^/?]+/, '');
    this.log.push(`${method} ${decodeURIComponent(path.split('?')[0]) || '/'}`);
    const body = init?.body ? JSON.parse(init.body as string) : null;
    if (method === 'POST' && path === '/pages') return this.submitPage(body);
    if (method === 'POST' && path === '/normalize') return this.submitNormalization(body);
    if (method === 'DELETE' && path.startsWith('/pages/')) {
      this.pages.delete(decodeURIComponent(path.slice('/pages/'.length).split('?')[0]));
      this.changed();
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE') {
      this.reset();
      return new Response(null, { status: 204 });
    }
    return this.view(new URL(url, 'http://test').searchParams, init?.signal);
  });

  /** Finish held jobs, as Spark eventually answers. */
  release(outcome: 'done' | 'failed' = 'done') {
    for (const page of this.pages.values()) {
      if (page.state === 'running') this.finish(page, outcome);
    }
    if (this.normalization.state === 'running') {
      this.normalization =
        outcome === 'done'
          ? { state: 'done', result: recordsFixture() }
          : { state: 'failed', error: 'Results normalization did not finish. Please try again.' };
    }
    this.changed();
  }

  reset() {
    this.pages.clear();
    this.normalization = { state: 'idle' };
    this.exists = false;
    this.changed();
  }

  private submitPage(body: Record<string, unknown>) {
    const outcome = this.pageOutcome(body);
    if (outcome === 'busy')
      return json({ message: 'Many pages are waiting. Try again shortly.' }, 429);
    this.exists = true;
    this.submitted.push(body);
    const page: FakePage = {
      pageId: body['pageId'] as string,
      revision: body['revision'] as string,
      state: 'running',
      body,
    };
    this.pages.set(page.pageId, page);
    if (outcome !== 'hold') this.finish(page, outcome);
    this.changed();
    return json({ pageId: page.pageId, revision: page.revision, state: page.state }, 202);
  }

  private submitNormalization(body: Record<string, unknown>) {
    this.exists = true;
    this.normalizations.push(body);
    this.normalization =
      this.normalizeOutcome === 'hold'
        ? { state: 'running' }
        : this.normalizeOutcome === 'done'
          ? { state: 'done', result: recordsFixture((body['documents'] as unknown[]).length) }
          : { state: 'failed', error: 'Results normalization did not finish. Please try again.' };
    this.changed();
    return json({ state: this.normalization.state }, 202);
  }

  private async view(params: URLSearchParams, signal?: AbortSignal | null) {
    if (!this.exists) return json({ version: 0, pages: [], normalization: { state: 'idle' } });
    const since = Number(params.get('since')),
      wait = Number(params.get('wait'));
    if (wait > 0 && this.version <= since) {
      await new Promise<void>((resolve, reject) => {
        this.waiters.push(resolve);
        setTimeout(resolve, this.pollMs);
        signal?.addEventListener('abort', () => reject(signal.reason));
      });
    }
    return json({
      version: this.version,
      pages: [...this.pages.values()].map(({ body: _body, ...page }) => page),
      normalization: this.normalization,
    });
  }

  private finish(page: FakePage, outcome: 'done' | 'failed') {
    page.state = outcome;
    const { image: _image, ...source } = page.body;
    if (outcome === 'done') page.result = processedFixture(source as never);
    else page.error = 'This page could not finish transcription. Please try again.';
  }

  private changed() {
    this.version++;
    for (const wake of this.waiters.splice(0)) wake();
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const report = (pages = 1): DocumentManifest => ({
  name: 'PRIVATE-TITLE',
  sourceKind: 'pdf',
  hiddenCount: 1,
  pages: Array.from({ length: pages }, (_, index) => ({
    index,
    width: 100,
    height: 100,
    hasImage: true,
    ocr: true,
    regions: [],
    words: [
      { t: 'LOCAL-OCR-NOT-AUTHORITATIVE', l: 0 },
      { t: 'HIDDEN-SECRET', h: true, l: 1 },
    ],
  })),
});
const history = new LocalHistory();
const newService = () => {
  const service = TestBed.runInInjectionContext(() => new ResultsService());
  (service as unknown as { retryDelay: () => number }).retryDelay = () => 1;
  return service;
};
const create = (pages = 1, localId = 'local-id') =>
  history.create(
    report(pages),
    Array.from({ length: pages }, () => new Blob(['approved-pixels'], { type: 'image/png' })),
    'PRIVATE-FILENAME.pdf',
    localId,
    'saved-batch',
  );

describe('page transcription as jobs', () => {
  let server: FakeJobServer;
  beforeEach(async () => {
    localStorage.clear();
    localStorage.removeItem(LOCAL_HISTORY_KEY);
    server = new FakeJobServer();
    vi.stubGlobal('fetch', server.fetch);
    vi.stubGlobal('Blob', NativeBlob);
    // Native Blob is used by fake IndexedDB; emulate the browser reader at this I/O boundary.
    vi.stubGlobal(
      'FileReader',
      class {
        result = '';
        onload = () => {};
        onerror = () => {};
        readAsDataURL(blob: Blob) {
          void blob.arrayBuffer().then((b) => {
            this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`;
            this.onload();
          });
        }
      },
    );
    await deviceTransaction(['approved-images'], 'readwrite', (tx) => {
      tx.objectStore('approved-images').clear();
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends one approved image per page, no OCR, title, filename or hidden text, and confirms what it saved', async () => {
    await create(2);
    await newService().records();
    expect(server.submitted).toHaveLength(2);
    for (const call of server.fetch.mock.calls) {
      expect(call[1]?.body ?? '').not.toMatch(/PRIVATE-|HIDDEN-|LOCAL-OCR/);
    }
    expect(server.submitted[0]['image']).toBe(
      'data:image/png;base64,' + Buffer.from('approved-pixels').toString('base64'),
    );
    expect(server.submitted[0]).not.toHaveProperty('document');
    expect(server.normalizations[0]).not.toHaveProperty('image');
    expect(
      (server.normalizations[0]['documents'] as { observations: unknown[] }[])[0].observations,
    ).toHaveLength(2);
    expect(server.log.filter((r) => r.startsWith('DELETE /pages/'))).toHaveLength(2);
    expect(server.log.at(-1)).toBe('DELETE /');
    expect((await history.results()).observations[0].transcription?.value).toBe('2.4');
    const calls = server.fetch.mock.calls.length;
    expect((await newService().records()).model.state).toBe('ready');
    expect(server.fetch.mock.calls.length).toBe(calls);
  });

  it('keeps failed pages for an explicit retry, which sends only those pages', async () => {
    await create(3);
    server.pageOutcome = (body) => (body['page'] === 1 ? 'failed' : 'done');
    await expect(newService().records()).rejects.toThrow('could not finish transcription');
    expect(history.recordSnapshot().sources.map((s) => s.page)).toEqual([1]);
    expect(server.normalizations).toHaveLength(0);
    server.pageOutcome = () => 'done';
    server.submitted = [];
    await newService().retryRecords();
    expect(server.submitted.map((b) => b['page'])).toEqual([1]);
    expect(server.normalizations).toHaveLength(1);
  });

  it('resumes after a refresh without sending a page the server already holds', async () => {
    const saved = await create();
    server.pageOutcome = () => 'hold';
    const first = newService();
    first.prepareBatch('queue-batch', false);
    await settled(() => expect(server.submitted).toHaveLength(1));
    // A refresh: a new service instance finds the same batch and only waits for it.
    const second = newService();
    const pending = second.records();
    await settled(() => expect(server.log.filter((r) => r === 'GET /').length).toBeGreaterThan(2));
    server.release();
    await pending;
    expect(server.submitted).toHaveLength(1);
    expect((await history.results()).observations[0].documentId).toBe(saved.id);
  });

  it('sends the pages again when the server lost the batch', async () => {
    await create();
    server.pageOutcome = () => 'hold';
    const pending = newService().records();
    await settled(() => expect(server.submitted).toHaveLength(1));
    server.reset();
    server.pageOutcome = () => 'done';
    await pending;
    expect(server.submitted).toHaveLength(2);
  });

  it('waits and submits again when the queue is full', async () => {
    await create();
    let busy = 2;
    server.pageOutcome = () => (busy-- > 0 ? 'busy' : 'done');
    await newService().records();
    expect(server.submitted).toHaveLength(1);
    expect((await history.results()).observations).toHaveLength(1);
  });

  it('survives a dropped connection while waiting for results', async () => {
    await create();
    server.pageOutcome = () => 'hold';
    const fetch = server.fetch.getMockImplementation()!;
    let drops = 2;
    server.fetch.mockImplementation(async (url, init) => {
      if ((init?.method ?? 'GET') === 'GET' && server.submitted.length && drops-- > 0) {
        server.release();
        throw new TypeError('Failed to fetch');
      }
      return fetch(url, init);
    });
    await newService().records();
    expect((await history.results()).observations).toHaveLength(1);
  });

  it('does not ask the server anything while no page is approved', async () => {
    const api = newService();
    for (let i = 0; i < 5; i++) api.prepareBatch('queue-batch', false);
    await settled(() => expect(api.processing().stage).toBe('waiting'));
    expect(server.fetch).not.toHaveBeenCalled();
  });

  it('sends a newly approved page at once instead of after the current long poll', async () => {
    await create();
    server.pageOutcome = () => 'hold';
    server.pollMs = 60_000;
    const api = newService();
    api.prepareBatch('queue-batch', false);
    await settled(() => expect(server.submitted).toHaveLength(1));
    await create(1, 'second-local-id');
    api.prepareBatch('queue-batch', false);
    await settled(() => expect(server.submitted).toHaveLength(2));
    server.pollMs = 30;
    server.release();
    await settled(() => expect(api.processing().stage).toBe('waiting'));
  });

  it('transcribes during privacy review but normalizes only once the batch is ready', async () => {
    await create();
    const api = newService();
    api.prepareBatch('queue-batch', false);
    await settled(() => expect(api.processing().stage).toBe('waiting'));
    expect(server.normalizations).toHaveLength(0);
    api.prepareBatch('queue-batch', true);
    await settled(() => expect(api.processing().stage).toBe('ready'));
    expect(server.normalizations).toHaveLength(1);
  });

  it.each(['delete', 'replace'] as const)(
    'cancels the job and never saves a late result after %s',
    async (action) => {
      const saved = await create();
      server.pageOutcome = () => 'hold';
      const api = newService();
      const pending = api.records().catch(() => null);
      await settled(() => expect(server.submitted).toHaveLength(1));
      const oldRevision = server.submitted[0]['revision'];
      if (action === 'delete') await history.delete(saved.id);
      else
        await history.replace(saved.id, report(), [new Blob(['changed'], { type: 'image/png' })]);
      server.pageOutcome = () => 'done';
      server.release();
      await pending;
      expect(
        (await history.results()).observations.filter(
          (o) => o.sourceImage?.revision === oldRevision,
        ),
      ).toHaveLength(0);
      expect(server.log).toContain(`DELETE /pages/${saved.id}:0`);
    },
  );

  it('retries normalization without repeating saved transcriptions', async () => {
    await create();
    server.normalizeOutcome = 'failed';
    const api = newService();
    await expect(api.records()).rejects.toThrow('normalization did not finish');
    server.normalizeOutcome = 'done';
    server.submitted = [];
    await api.retryRecords();
    expect(server.submitted).toHaveLength(0);
    expect(server.normalizations).toHaveLength(2);
  });

  it('does not save a late normalization after a source is deleted', async () => {
    const saved = await create();
    server.normalizeOutcome = 'hold';
    const pending = newService().records();
    const rejected = expect(pending).rejects.toThrow('batch changed');
    await settled(() => expect(server.normalizations).toHaveLength(1));
    await history.delete(saved.id);
    server.release();
    await rejected;
    expect(history.cachedModelRecords()).toBeNull();
  });

  it('preserves source measurements through user corrections', async () => {
    const saved = await create();
    await newService().records();
    const original = (await history.results()).observations[0];
    await history.correct(saved.id, original.id, {
      name: 'TSH',
      valueText: '< 3.1',
      unit: null,
      date: null,
      note: 'Checked source',
      expectedRevision: original.revision!,
    });
    const corrected = (await history.results()).observations[0];
    expect(corrected).toMatchObject({
      valueText: '< 3.1',
      comparator: '<',
      transcription: { value: '2.4', unit: 'mIU/L' },
    });
    expect(history.recordSnapshot().sources).toHaveLength(0);
  });
});

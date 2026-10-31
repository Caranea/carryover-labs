import 'fake-indexeddb/auto';
import { Blob as NativeBlob } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsApi } from './documents-api';
import { LOCAL_HISTORY_KEY } from './local-history';
import type { DocumentManifest } from './models';
import { processedFixture, recordsFixture } from './processing-test-fixture';
import { deviceTransaction } from './device-storage';

const report = (pages = 1): DocumentManifest => ({ name: 'PRIVATE-TITLE', sourceKind: 'pdf', hiddenCount: 1,
  pages: Array.from({ length: pages }, (_, index) => ({ index, width: 100, height: 100, hasImage: true, ocr: true, regions: [],
    words: [{ t: 'LOCAL-OCR-NOT-AUTHORITATIVE', l: 0 }, { t: 'HIDDEN-SECRET', h: true, l: 1 }] })) });
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const serverFetch = async (url: string, options?: RequestInit) => {
  const body = JSON.parse(options!.body as string);
  return json(url.endsWith('extract') ? processedFixture(body) : recordsFixture(body.documents.length));
};
const create = (api: DocumentsApi, pages = 1) => api.create(report(pages), Array.from({ length: pages }, () => new Blob(['approved-pixels'], { type: 'image/png' })), 'PRIVATE-FILENAME.pdf', 'local-id', 'saved-batch');

describe('page transcription and batch recovery', () => {
  beforeEach(async () => {
    localStorage.removeItem(LOCAL_HISTORY_KEY);
    vi.stubGlobal('Blob', NativeBlob);
    // Native Blob is used by fake IndexedDB; emulate the browser reader at this I/O boundary.
    vi.stubGlobal('FileReader', class { result = ''; onload = () => {}; onerror = () => {};
      readAsDataURL(blob: Blob) { void blob.arrayBuffer().then(b => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onload(); }); }
    });
    await deviceTransaction(['approved-images'], 'readwrite', tx => { tx.objectStore('approved-images').clear(); });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('sends one approved image per request, no OCR, title, filename or hidden text, then saves immutable transcription', async () => {
    const api = new DocumentsApi(); await create(api, 2);
    const fetchMock = vi.fn(serverFetch); vi.stubGlobal('fetch', fetchMock);
    await api.records();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(options?.body).not.toMatch(/PRIVATE-|HIDDEN-|LOCAL-OCR|sourceEvidence|classifications/);
      const body = JSON.parse(options!.body as string);
      if (url.endsWith('extract')) {
        expect(body.image).toBe('data:image/png;base64,' + Buffer.from('approved-pixels').toString('base64'));
        expect(body.batchId).toBe('saved-batch'); expect(body).not.toHaveProperty('document');
      } else { expect(body).not.toHaveProperty('image'); expect(body.documents[0].observations).toHaveLength(2); }
    }
    expect((await api.results()).observations[0].transcription?.value).toBe('2.4');
    expect((await new DocumentsApi().records()).model.state).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('saves completed pages immediately, bounds concurrency and retries only failures after refresh', async () => {
    const api = new DocumentsApi(); await create(api, 6);
    let active = 0, peak = 0;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      const body = JSON.parse(options!.body as string);
      if (!url.endsWith('extract')) return serverFetch(url, options);
      peak = Math.max(peak, ++active);
      await new Promise(r => setTimeout(r, 5)); active--;
      return body.page === 2 ? new Response('{}', { status: 502 }) : serverFetch(url, options);
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.records()).rejects.toThrow();
    expect(peak).toBe(3); expect(api.recordSnapshot().sources.map(s => s.page)).toEqual([2]);
    expect(fetchMock.mock.calls.every(([url]) => url.endsWith('extract'))).toBe(true);
    fetchMock.mockClear().mockImplementation(serverFetch);
    await new DocumentsApi().retryRecords();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/demo/extract', '/api/demo/records']);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string).page).toBe(2);
  });

  it('transcribes approved pages during privacy review but waits for the retained batch to normalize', async () => {
    const api = new DocumentsApi(); await create(api);
    const fetchMock = vi.fn(serverFetch); vi.stubGlobal('fetch', fetchMock);
    api.prepareBatch('restored-batch', false);
    await vi.waitFor(() => expect(api.processing().stage).toBe('waiting'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    api.prepareBatch('restored-batch', true);
    await vi.waitFor(() => expect(api.processing().stage).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string).batchId).toBe('restored-batch');
  });

  it.each(['delete', 'replace'] as const)('does not restore a late page response after %s', async action => {
    const api = new DocumentsApi(); const saved = await create(api);
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn((url: string, options?: RequestInit) => new Promise<Response>(r => { resolve = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.records().catch(() => null);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const request = JSON.parse(fetchMock.mock.calls[0][1]!.body as string);
    if (action === 'delete') await api.delete(saved.id);
    else await api.replace(saved.id, report(), [new Blob(['changed'], { type: 'image/png' })]);
    // New requests fail; the obsolete response must never populate the replacement.
    fetchMock.mockRejectedValue(new Error('offline'));
    resolve(json(processedFixture(request)));
    await pending;
    expect((await api.results()).observations).toHaveLength(0);
  });

  it('retries normalization without repeating saved transcriptions', async () => {
    const api = new DocumentsApi(); await create(api);
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => url.endsWith('records') ? new Response('{}', { status: 502 }) : serverFetch(url, options));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.records()).rejects.toThrow();
    fetchMock.mockClear().mockImplementation(serverFetch);
    await api.retryRecords();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/demo/records']);
  });

  it('preserves source measurements through user corrections and refuses stale saves', async () => {
    const api = new DocumentsApi(); const saved = await create(api);
    vi.stubGlobal('fetch', vi.fn(serverFetch)); await api.records();
    const original = (await api.results()).observations[0];
    await api.correct(saved.id, original.id, { name: 'TSH', valueText: '< 3.1', unit: null, date: null, note: 'Checked source', expectedRevision: original.revision! });
    const corrected = (await api.results()).observations[0];
    expect(corrected).toMatchObject({ valueText: '< 3.1', comparator: '<', transcription: { value: '2.4', unit: 'mIU/L' } });
    expect(api.recordSnapshot().sources).toHaveLength(0);
  });

  it('keeps missed-reading recovery on images and requires explicit acceptance of its source-linked proposal', async () => {
    const api = new DocumentsApi(); const saved = await create(api);
    const fetchMock = vi.fn(serverFetch); vi.stubGlobal('fetch', fetchMock); await api.records();
    fetchMock.mockImplementation(async (_url, options) => {
      const request = JSON.parse(options!.body as string);
      expect(request.image).toBeTruthy(); expect(request).not.toHaveProperty('document');
      const answer = processedFixture(request);
      answer.rows[0].name = 'Ferritin'; answer.observations[0].name = 'Ferritin';
      const otherSpecimen = { ...answer.rows[0], name: 'TSH', specimen: 'urine' };
      answer.rows.push(otherSpecimen);
      answer.observations.push({ ...answer.observations[0], id: `${request.pageId}:1`, name: 'TSH', transcription: otherSpecimen,
        sourceImage: { pageId: request.pageId, revision: request.revision, row: 1 } });
      return json(answer);
    });
    const state = await api.recovery(saved.id);
    await api.findMissedReadings(saved.id, { page: 0, expectedRevision: state.sourceRevision });
    await vi.waitFor(async () => expect((await api.recovery(saved.id)).status).toBe('ready'));
    const proposal = (await api.recovery(saved.id)).proposals[0];
    expect((await api.recovery(saved.id)).proposals).toHaveLength(2);
    expect((await api.results()).observations).toHaveLength(1);
    await api.acceptRecoveredReading(saved.id, proposal.id, { expectedRevision: proposal.revision, note: 'Checked printed row' });
    const recovered = (await api.results()).observations[1];
    expect(recovered.sourceImage?.pageId).toBe(`${saved.id}:0`);
    expect(recovered.transcription?.name).toBe('Ferritin'); expect(recovered.confirmed).toBe(true);
    expect(api.cachedModelRecords()).toBeNull();
  });

  it('does not save a late normalization after a source is deleted', async () => {
    const api = new DocumentsApi(); const saved = await create(api);
    let resolve!: (response: Response) => void;
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => url.endsWith('extract') ? serverFetch(url, options) : new Promise<Response>(r => { resolve = r; }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.records(); const rejected = expect(pending).rejects.toThrow('batch changed');
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await api.delete(saved.id); resolve(json(recordsFixture())); await rejected;
    expect(api.cachedModelRecords()).toBeNull(); expect(await api.list()).toHaveLength(0);
  });
});

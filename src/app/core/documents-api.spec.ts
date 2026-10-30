import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DocumentsApi } from './documents-api';
import { LocalHistory, LOCAL_HISTORY_KEY } from './local-history';
import type { DocumentManifest } from './models';

function report(): DocumentManifest {
  const word = (t: string, l: number, x: number) => ({ t, l, b: [x, 20 + l * 30, Math.max(12, t.length * 8), 18] as [number, number, number, number] });
  return { name: 'Synthetic source', sourceKind: 'text', hiddenCount: 1,
    pages: [{ index: 0, width: 1200, height: 500, hasImage: false, ocr: false, regions: [], words: [
      word('Collected', 0, 40), word('2024-01-01', 0, 150), word('TSH', 2, 40),
      word('1,50', 3, 40), word('mIU/L', 3, 130), word('0,35', 3, 240), word('–', 3, 290), word('4,94', 3, 320),
      { t: 'HIDDEN-SECRET', h: true, l: 7, b: [40, 230, 120, 18] },
    ] }] };
}
const evidence = { name: [2], value: [3], unit: [4], date: [1], reference: [5, 6, 7] };
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
const proposal = { id: 'proposal', page: 0, name: 'TSH', valueText: '1,50', unit: 'mIU/L', date: '2024-01-01', dateText: '2024-01-01', refText: '0,35 – 4,94', words: [1, 2, 3, 4, 5, 6, 7], bbox: null, evidence, issues: [], state: 'pending', revision: 'revision', decidedAt: null, note: null };

describe('browser history with stateless Meta checks', () => {
  beforeEach(() => localStorage.removeItem(LOCAL_HISTORY_KEY));
  afterEach(() => vi.unstubAllGlobals());

  it('retains original filenames across reloads and edits without sending them in either AI request', async () => {
    const originalFileName = 'Fictional_Patient_44051401359.pdf';
    const api = new DocumentsApi();
    const saved = await api.create(report(), [null], originalFileName);
    const reopened = new DocumentsApi();
    expect((await reopened.list())[0].originalFileName).toBe(originalFileName);
    const document = await reopened.get(saved.id);
    expect(document.originalFileName).toBe(originalFileName);
    // Passing a locally decorated document back through a save must not copy its
    // filename into the approved manifest used for later processing requests.
    expect((await reopened.replace(saved.id, document, [null])).originalFileName).toBe(originalFileName);
    expect((await new DocumentsApi().list())[0].originalFileName).toBe(originalFileName);
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.body).not.toContain(originalFileName);
      expect(options?.body).not.toContain('originalFileName');
      return url.endsWith('records')
        ? json({ ...await new LocalHistory().records(), model: { state: 'ready', name: 'Synthetic Meta', waiting: 0, message: null } })
        : json({ sourceRevision: 'source', proposals: [], modelName: 'Synthetic Meta', limits: (await reopened.recovery(saved.id)).limits });
    });
    vi.stubGlobal('fetch', fetchMock);
    await reopened.records();
    const recovery = await reopened.recovery(saved.id);
    await reopened.findMissedReadings(saved.id, { page: 0, expectedRevision: recovery.sourceRevision });
    await vi.waitFor(async () => expect((await reopened.recovery(saved.id)).status).toBe('ready'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await reopened.delete(saved.id);
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).not.toContain(originalFileName);
  });

  it('coalesces simultaneous checks and reuses saved AI results after a reload', async () => {
    const api = new DocumentsApi();
    await api.create(report(), [null]);
    const result = { ...await new LocalHistory().records(), model: { state: 'ready', name: 'Synthetic Meta', waiting: 0, message: null } };
    const fetchMock = vi.fn(async (_url: string) => json(result));
    vi.stubGlobal('fetch', fetchMock);
    await Promise.all([api.records(), api.records()]);
    await vi.waitFor(async () => expect((await api.records()).model.state).toBe('ready'));
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('records'))).toHaveLength(1);
    expect((await new DocumentsApi().records()).model.state).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/demo/records');
  });

  it('waits for server processing and retries a failure without returning local charts', async () => {
    const api = new DocumentsApi(); const saved = await api.create(report(), [null]);
    let fail!: (reason: Error) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>((_resolve, reject) => { fail = reject; }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = api.records();
    const rejected = expect(pending).rejects.toThrow('Please try again');
    expect(new LocalHistory().cachedModelRecords()).toBeNull();
    fail(new Error('Network disconnected'));
    await rejected;
    expect((await api.get(saved.id)).name).toBe('Synthetic source');
    expect(new LocalHistory().cachedModelRecords()).toBeNull();

    const result = { ...await new LocalHistory().records(), model: { state: 'ready', name: 'Synthetic Meta', waiting: 0, message: null } };
    fetchMock.mockResolvedValueOnce(json(result));
    expect((await api.retryRecords()).model.state).toBe('ready');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(['off', 'working', 'error'] as const)('rejects an incomplete %s response and ignores an old incomplete cache', async (state) => {
    const api = new DocumentsApi(); await api.create(report(), [null]);
    const result = { ...await new LocalHistory().records(), model: { state, name: null, waiting: 0, message: null } };
    api.saveModelRecords(api.recordSnapshot().fingerprint, result);
    const fetchMock = vi.fn().mockResolvedValue(json(result));
    vi.stubGlobal('fetch', fetchMock);
    await expect(api.records()).rejects.toThrow('processing did not finish');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('processes newly approved data even when earlier server results are cached', async () => {
    const api = new DocumentsApi(); await api.create(report(), [null]);
    const fetchMock = vi.fn(async () => json({ ...await new LocalHistory().records(), model: { state: 'ready', name: 'Synthetic Meta', waiting: 0, message: null } }));
    vi.stubGlobal('fetch', fetchMock);
    await api.records();
    await api.create(report(), [null]);
    const result = await api.records();
    expect(result.stats.documents).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('never restores deleted history when an older AI request finishes', async () => {
    const api = new DocumentsApi(); const saved = await api.create(report(), [null]);
    const result = { ...await new LocalHistory().records(), model: { state: 'ready', name: 'Synthetic Meta', waiting: 0, message: null } };
    let finish!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { finish = resolve; })));
    const pending = api.records(); await api.delete(saved.id);
    finish(json(result));
    expect((await pending).stats.documents).toBe(0);
    expect(new LocalHistory().cachedModelRecords()).toBeNull();
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).not.toContain('TSH');
  });

  it('saves recovery suggestions locally, requires confirmation, and keeps accepted source evidence after reload', async () => {
    const api = new DocumentsApi(); const saved = await api.create(report(), [null]);
    const fetchMock = vi.fn(async (url: string, options?: RequestInit) => {
      expect(options?.headers).toEqual({ 'Content-Type': 'application/json' });
      expect(options?.body).not.toContain('HIDDEN-SECRET');
      const body = JSON.parse(options!.body as string);
      expect(body).not.toHaveProperty('userId'); expect(body).not.toHaveProperty('deviceId');
      return json({ sourceRevision: 'source', proposals: [proposal], modelName: 'Synthetic Meta', limits: (await api.recovery(saved.id)).limits });
    });
    vi.stubGlobal('fetch', fetchMock);
    const initial = await api.recovery(saved.id);
    await api.findMissedReadings(saved.id, { page: 0, expectedRevision: initial.sourceRevision });
    await vi.waitFor(async () => expect((await api.recovery(saved.id)).status).toBe('ready'));
    expect((await api.results()).observations).toHaveLength(0);
    await api.acceptRecoveredReading(saved.id, 'proposal', { expectedRevision: 'revision', note: 'Checked the fictional source.' });
    const reopened = new DocumentsApi();
    expect((await reopened.results()).observations[0]).toMatchObject({ name: 'TSH', value: 1.5, confirmed: true, recovery: { evidence } });
    expect((await reopened.recovery(saved.id)).proposals[0].state).toBe('accepted');
    await expect(reopened.acceptRecoveredReading(saved.id, 'proposal', { expectedRevision: 'revision', note: 'Again' })).rejects.toThrow('suggestion changed');
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('recovery'))).toHaveLength(1);
  });
});

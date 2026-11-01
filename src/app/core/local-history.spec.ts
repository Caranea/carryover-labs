import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { Blob as NativeBlob } from 'node:buffer';
import { deviceTransaction } from './device-storage';
import { LocalHistory, LOCAL_HISTORY_KEY } from './local-history';
import type { DocumentManifest, StoredWord } from './models';
import { processedFixture, recordsFixture } from './processing-test-fixture';

async function serverProcessed(history: LocalHistory, id: string) {
  const source = history.recordSnapshot().sources.find((s) => s.documentId === id)!;
  history.savePageProcessing(id, source.revision, processedFixture(source));
  history.saveModelRecords(
    history.recordSnapshot().fingerprint,
    recordsFixture(history.recordSnapshot().documents.length),
  );
}

function report(image = false): DocumentManifest {
  const words: StoredWord[] = [];
  const rows: [string, number][][] = [
    [['Collection date: 2026-09-15', 40]],
    [
      ['Test', 40],
      ['Result', 400],
      ['Unit', 600],
      ['Reference', 800],
    ],
    [
      ['TSH', 40],
      ['2.4', 400],
      ['mIU/L', 600],
      ['0.4-4.0', 800],
    ],
  ];
  rows.forEach((row, line) =>
    row.forEach(([text, left]) => {
      let x = left;
      for (const token of text.split(' ')) {
        words.push({ t: token, l: line, b: [x, 30 + line * 30, token.length * 9, 18] });
        x += token.length * 9 + 9;
      }
    }),
  );
  return {
    name: 'Fictional report',
    sourceKind: image ? 'image' : 'text',
    hiddenCount: 0,
    pages: [
      { index: 0, width: 1200, height: 1700, hasImage: image, ocr: false, words, regions: [] },
    ],
  };
}

function asDataUrl(blob: Blob): Promise<string> {
  return blob
    .arrayBuffer()
    .then(
      (bytes) => `data:${blob.type};base64,${btoa(String.fromCharCode(...new Uint8Array(bytes)))}`,
    );
}

describe('persistent browser demo history', () => {
  beforeEach(async () => {
    vi.stubGlobal('Blob', NativeBlob);
    localStorage.removeItem(LOCAL_HISTORY_KEY);
    await deviceTransaction(['approved-images'], 'readwrite', (tx) => {
      tx.objectStore('approved-images').clear();
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('saves only the approved source locally, then reopens cached server readings and charts', async () => {
    const originalImage = new Blob(['fictional approved pixels'], { type: 'image/jpeg' });
    const saved = await new LocalHistory().create(report(true), [originalImage]);
    const reopened = new LocalHistory();
    expect((await reopened.list()).map((doc) => doc.id)).toEqual([saved.id]);
    expect((await reopened.results()).observations).toEqual([]);
    await expect(reopened.savedRecords()).rejects.toThrow('server processing');
    await serverProcessed(reopened, saved.id);
    const results = await reopened.results();
    expect(results.observations).toHaveLength(1);
    expect(results.observations[0]).toMatchObject({ name: 'TSH', value: 2.4, date: '2026-09-15' });
    expect((await reopened.savedRecords()).stats.values).toBe(1);
    expect(await asDataUrl(await reopened.pageImage(saved.id, 0))).toBe(
      await asDataUrl(originalImage),
    );
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).toContain('TSH');
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).not.toContain('base64');
  });

  it('parses the saved history once for repeated reads, and again only when it changed', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(true), [new Blob(['px'], { type: 'image/jpeg' })]);
    const parse = vi.spyOn(JSON, 'parse');
    for (let i = 0; i < 5; i++) history.recordSnapshot();
    expect(parse).not.toHaveBeenCalled();
    // Another tab wrote a different history: the next read sees it.
    const other = JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY)!);
    parse.mockClear();
    other.entries[0].document.name = 'Changed elsewhere';
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(other));
    expect((await history.list()).find((d) => d.id === saved.id)?.name).toBe('Changed elsewhere');
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it('reads an older base64 image and keeps the same approval when retried after refresh', async () => {
    const history = new LocalHistory();
    const saved = await history.create(
      report(true),
      [new Blob(['pixels'], { type: 'image/jpeg' })],
      'source.jpg',
      'original-queue-id',
    );
    const retried = await new LocalHistory().create(
      report(true),
      [new Blob(['pixels'])],
      'source.jpg',
      'original-queue-id',
    );
    expect(retried.id).toBe(saved.id);
    expect(await history.list()).toHaveLength(1);
    expect(history.approvedQueueDocuments().get('original-queue-id')?.id).toBe(saved.id);
    expect(JSON.stringify(history.recordSnapshot())).not.toContain('original-queue-id');
    const state = JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY)!);
    state.entries[0].images = { '0': 'data:image/jpeg;base64,cGl4ZWxz' };
    delete state.entries[0].imageRefs;
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(state));
    expect(await (await new LocalHistory().pageImage(saved.id, 0)).text()).toBe('pixels');
  });

  it('removes binary images after deletion and cleans up a save rejected by localStorage', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(true), [new Blob(['pixels'])]);
    const count = () =>
      deviceTransaction<number>(['approved-images'], 'readonly', (tx, result) => {
        const request = tx.objectStore('approved-images').count();
        request.onsuccess = () => result(request.result);
      });
    expect(await count()).toBe(1);
    await history.delete(saved.id);
    expect(await count()).toBe(0);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(history.create(report(true), [new Blob(['pixels'])])).rejects.toThrow(
      'previous results are unchanged',
    );
    expect(await count()).toBe(0);
  });

  it('keeps existing data intact when a new save or replacement exceeds storage quota', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(), [null]);
    const before = localStorage.getItem(LOCAL_HISTORY_KEY);
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    await expect(history.create(report(), [null])).rejects.toThrow(
      'previous results are unchanged',
    );
    await expect(
      history.replace(saved.id, { ...report(), name: 'Changed' }, [null]),
    ).rejects.toThrow('previous results are unchanged');
    setItem.mockRestore();
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).toBe(before);
    expect((await history.list())[0].name).toBe('Fictional report');
  });

  it('persists checked comparisons with their original reading and rejects stale corrections', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(), [null]);
    await serverProcessed(history, saved.id);
    const original = (await history.results()).observations[0];
    const change = {
      name: 'TSH',
      valueText: '< 3,1',
      unit: 'mIU/L',
      date: '2026-09-15',
      note: 'Checked the fictional source',
      expectedRevision: original.revision!,
    };
    await history.correct(saved.id, original.id, change);
    const result = (await new LocalHistory().results()).observations[0];
    expect(result).toMatchObject({
      value: 3.1,
      comparator: '<',
      confirmed: true,
      original: { valueText: '2.4' },
    });
    expect(result.corrections).toHaveLength(1);
    await expect(history.correct(saved.id, original.id, change)).rejects.toThrow('reading changed');
    await expect(
      history.correct(saved.id, original.id, {
        ...change,
        date: '2026-02-30',
        expectedRevision: result.revision!,
      }),
    ).rejects.toThrow('valid collection date');
  });

  it('removes readings and their correction text when more source content is hidden', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(), [null]);
    await serverProcessed(history, saved.id);
    const original = (await history.results()).observations[0];
    await history.correct(saved.id, original.id, {
      name: 'TSH',
      valueText: '2.4',
      unit: 'mIU/L',
      date: '2026-09-15',
      note: 'Unique old correction',
      expectedRevision: original.revision!,
    });
    const redacted = report();
    redacted.pages[0].words = redacted.pages[0].words.map((word) =>
      word.l === 2 ? { ...word, h: true } : word,
    );
    await history.replace(saved.id, redacted, [null]);
    expect((await history.results()).observations).toEqual([]);
    expect(history.cachedModelRecords()).toBeNull();
    expect(history.recordSnapshot().sources).toHaveLength(1);
    const stored = localStorage.getItem(LOCAL_HISTORY_KEY)!;
    expect(stored).not.toContain('TSH');
    expect(stored).not.toContain('Unique old correction');
    await expect(history.replace(saved.id, report(), [null])).rejects.toThrow('stay hidden');
  });

  it('deletes sources and results together without leaving cached copies', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(), [null]);
    await serverProcessed(history, saved.id);
    await history.savedRecords();
    await history.delete(saved.id);
    const reopened = new LocalHistory();
    expect(await reopened.list()).toEqual([]);
    expect((await reopened.results()).observations).toEqual([]);
    expect((await reopened.savedRecords()).stats.values).toBe(0);
    await expect(reopened.get(saved.id)).rejects.toThrow('no longer saved');
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).not.toContain('TSH');
  });

  it('preserves unreadable data instead of silently overwriting it with an empty history', async () => {
    localStorage.setItem(LOCAL_HISTORY_KEY, '{broken');
    const history = new LocalHistory();
    await expect(history.list()).rejects.toThrow('could not be read');
    await expect(history.create(report(), [null])).rejects.toThrow('could not be read');
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).toBe('{broken');
  });

  it('retains both documents when image conversion overlaps another save', async () => {
    const history = new LocalHistory();
    await Promise.all([
      history.create(report(true), [new Blob(['pixels'], { type: 'image/jpeg' })]),
      history.create(report(), [null]),
    ]);
    expect(await history.list()).toHaveLength(2);
    expect((await history.results()).observations).toHaveLength(0);
    expect(history.recordSnapshot().sources).toHaveLength(2);
  });

  it('replaces legacy parser guesses with server results but preserves user-confirmed corrections', async () => {
    const history = new LocalHistory();
    const saved = await history.create(report(), [null]);
    await serverProcessed(history, saved.id);
    const original = (await history.results()).observations[0];
    await history.correct(saved.id, original.id, {
      name: 'TSH',
      valueText: '2.5',
      unit: 'mIU/L',
      date: '2026-09-15',
      note: 'Checked the original',
      expectedRevision: original.revision!,
    });
    const state = JSON.parse(localStorage.getItem(LOCAL_HISTORY_KEY)!);
    delete state.entries[0].transcriptions;
    state.entries[0].observations.push({
      ...original,
      id: 'old-parser-guess',
      confirmed: false,
      name: 'Merged wrong name',
    });
    state.modelRecords = {
      fingerprint: history.recordSnapshot().fingerprint,
      records: recordsFixture(),
    };
    localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(state));
    expect(history.cachedModelRecords()).toBeNull();
    expect(history.recordSnapshot().sources).toHaveLength(1);
    await serverProcessed(history, saved.id);
    expect((await history.results()).observations).toHaveLength(1);
    expect((await history.results()).observations[0]).toMatchObject({
      value: 2.5,
      confirmed: true,
    });
    expect(localStorage.getItem(LOCAL_HISTORY_KEY)).not.toContain('Merged wrong name');
  });

  it('uses the server name suggestion only for a generic default, preserving custom names', async () => {
    const history = new LocalHistory();
    const defaultDoc = await history.create({ ...report(), name: 'Lab document 7' }, [null]);
    const custom = await history.create({ ...report(), name: 'My annual report' }, [null]);
    await serverProcessed(history, defaultDoc.id);
    await serverProcessed(history, custom.id);
    expect((await history.get(defaultDoc.id)).name).toBe('Thyroid tests');
    expect((await history.get(custom.id)).name).toBe('My annual report');
    const records = recordsFixture();
    records.warnings.push({
      documentId: custom.id,
      documentName: 'Lab document',
      observationId: 'source-row',
      page: 0,
      bbox: null,
      reason: 'unit',
      by: 'rules',
      detail: 'Missing unit',
      printedName: 'TSH',
      printedValue: '2.4',
      printedUnit: null,
      date: null,
    });
    history.saveModelRecords(history.recordSnapshot().fingerprint, records);
    expect(history.cachedModelRecords()?.warnings[0].documentName).toBe('My annual report');
  });
});

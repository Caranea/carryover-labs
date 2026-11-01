import { settled } from '../../testing/settled';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionService } from '../extraction/extraction.service';
import { NerService } from '../pii/ner.service';
import { DocumentQueueService } from './document-queue.service';
import { LocalHistory } from './local-history';
import { ResultsService } from './results.service';
import type { DocumentManifest, WorkingPage } from './models';
import type { PagePredictions } from '../pii/detect';
import { toStoredPage } from '../redaction/burn';

const page = (): WorkingPage => ({
  index: 0,
  width: 100,
  height: 100,
  image: null,
  imageUrl: null,
  ocr: false,
  regions: [],
  words: [{ id: 1, text: 'TSH', line: 0, hidden: false, box: { x: 5, y: 5, w: 20, h: 10 } }],
});

function setup(incomplete = false) {
  const create = vi.fn(
    async (manifest: DocumentManifest, _images: (Blob | null)[], originalFileName?: string) => ({
      id: 'saved',
      ...manifest,
      originalFileName,
      pageCount: manifest.pages.length,
      createdAt: '',
      updatedAt: '',
    }),
  );
  const api = {
    prepareBatch: vi.fn(),
    processing: () => ({ stage: 'idle', total: 0 }),
    create,
    list: vi.fn(async () => []),
    get: vi.fn(),
    pageImage: vi.fn(),
  };
  const extraction = { extract: vi.fn(async () => [page()]) };
  const ner = {
    load: vi.fn(async () => true),
    predict: vi.fn(
      async (_pages: WorkingPage[], _signal?: AbortSignal): Promise<PagePredictions[]> =>
        incomplete ? [null] : [new Map([[1, { label: 'O', score: 1 }]])],
    ),
    retry: vi.fn(),
    cancel: vi.fn(),
    error: vi.fn(() => (incomplete ? 'The full privacy checker could not start.' : null)),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ExtractionService, useValue: extraction },
      { provide: NerService, useValue: ner },
      { provide: ResultsService, useValue: api },
      { provide: LocalHistory, useValue: api },
    ],
  });
  return { queue: TestBed.inject(DocumentQueueService), create, ner, api, extraction };
}

describe('document privacy boundary', () => {
  it('carries automatically identified names into later manual documents after the source is approved', async () => {
    const { queue, extraction, create } = setup();
    const namePage = (labelled: boolean): WorkingPage => ({
      ...page(),
      words: (labelled ? ['Patient:', 'Jane', 'Doe'] : ['jane', 'doe']).map(
        (text, id) => ({ id, text, line: 0, hidden: false }),
      ),
    });
    extraction.extract.mockImplementationOnce(async () => [namePage(true)]);
    const [first] = queue.add([new File(['fictional'], 'first.txt')]);
    await settled(() => expect(queue.byId(first)?.status).toBe('review'));
    expect(await queue.approve(first)).toBe(true);
    extraction.extract.mockImplementationOnce(async () => [namePage(false)]);
    const [next] = queue.add([new File(['fictional'], 'next.txt')], 'lightweight');
    await settled(() => expect(queue.byId(next)?.status).toBe('review'));
    expect(
      queue.byId(next)?.pages[0].words.every((w) => w.hidden && w.source === 'remembered'),
    ).toBe(true);
    expect(await queue.approve(next)).toBe(true);
    expect(JSON.stringify(create.mock.calls.map((call) => call[0]))).not.toMatch(
      /Jane|Doe|jane|doe|rememberedDetails/,
    );
  });

  it('spreads manual edits to already-ready documents without overriding an explicit Keep', async () => {
    const { queue, extraction } = setup();
    extraction.extract.mockImplementation(async () => [
      { ...page(), words: [{ id: 0, text: 'Jane', line: 0, hidden: false }] },
    ]);
    const ids = queue.add(
      ['one.txt', 'two.txt'].map((name) => new File(['fictional'], name)),
      'lightweight',
    );
    await settled(() => expect(ids.every((id) => queue.byId(id)?.status === 'review')).toBe(true));
    queue.toggleWord(ids[0], 0, 0);
    expect(queue.byId(ids[1])?.pages[0].words[0]).toMatchObject({
      hidden: true,
      source: 'remembered',
    });
    queue.toggleWord(ids[1], 0, 0); // Keep this occurrence.
    queue.toggleWord(ids[0], 0, 0);
    queue.toggleWord(ids[0], 0, 0);
    expect(queue.byId(ids[1])?.pages[0].words[0]).toMatchObject({ hidden: false, userSet: true });
  });

  it('remembers words in a drawn box without making that box impossible to undo', async () => {
    const { queue, extraction } = setup();
    extraction.extract.mockImplementation(async () => [
      { ...page(), words: [{ ...page().words[0], text: 'Jane' }] },
    ]);
    const ids = queue.add(
      ['one.txt', 'two.txt'].map((name) => new File(['fictional'], name)),
      'lightweight',
    );
    await settled(() => expect(ids.every((id) => queue.byId(id)?.status === 'review')).toBe(true));
    queue.addRegion(ids[0], 0, { x: 0, y: 0, w: 30, h: 20 });
    expect(queue.byId(ids[1])?.pages[0].words[0].hidden).toBe(true);
    queue.removeRegion(ids[0], 0, 0);
    expect(toStoredPage(queue.byId(ids[0])!.pages[0]).words[0].t).toBe('Jane');
    expect(queue.byId(ids[1])?.pages[0].words[0].hidden).toBe(false);
    const [third] = queue.add([new File(['fictional'], 'three.txt')], 'lightweight');
    await settled(() => expect(queue.byId(third)?.status).toBe('review'));
    expect(queue.byId(third)?.pages[0].words[0].hidden).toBe(false);
  });

  it('undoes and redoes hand edits in order, and a new edit clears redo', async () => {
    const { queue, extraction } = setup();
    extraction.extract.mockImplementation(async () => [
      { ...page(), words: [{ id: 0, text: 'Alexandra', line: 0, hidden: false }] },
    ]);
    const [id] = queue.add([new File(['fictional'], 'one.txt')], 'lightweight');
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    const word = () => queue.byId(id)!.pages[0].words[0];
    expect(queue.canUndo(id)).toBe(false);

    queue.toggleWord(id, 0, 0);
    queue.addRegion(id, 0, { x: 40, y: 40, w: 10, h: 10 });
    expect(word().hidden).toBe(true);
    expect(queue.byId(id)!.pages[0].regions).toHaveLength(1);

    queue.undo(id);
    expect(queue.byId(id)!.pages[0].regions).toHaveLength(0);
    expect(word().hidden).toBe(true);
    queue.undo(id);
    expect(word().hidden).toBe(false);
    expect(queue.canUndo(id)).toBe(false);

    queue.redo(id);
    expect(word().hidden).toBe(true);
    expect(queue.canRedo(id)).toBe(true);
    queue.removeRegion(id, 0, 0); // No region to remove: not an edit, redo survives.
    expect(queue.canRedo(id)).toBe(true);
    queue.toggleWord(id, 0, 0);
    expect(queue.canRedo(id)).toBe(false);
    expect(queue.lastEdited()).toBe(id);

    queue.remove(id);
    expect(queue.canUndo(id)).toBe(false);
    expect(queue.lastEdited()).toBe(null);
  });

  it('undoes learned matches when the original click or source document is removed', async () => {
    const { queue, extraction } = setup();
    extraction.extract.mockImplementation(async () => [
      { ...page(), words: [{ id: 0, text: 'Alexandra', line: 0, hidden: false }] },
    ]);
    const ids = queue.add(
      ['one.txt', 'two.txt'].map((name) => new File(['fictional'], name)),
      'lightweight',
    );
    await settled(() => expect(ids.every((id) => queue.byId(id)?.status === 'review')).toBe(true));
    queue.toggleWord(ids[0], 0, 0);
    expect(queue.byId(ids[1])?.pages[0].words[0].hidden).toBe(true);
    queue.toggleWord(ids[0], 0, 0);
    expect(queue.byId(ids[1])?.pages[0].words[0].hidden).toBe(false);
    queue.toggleWord(ids[0], 0, 0);
    queue.remove(ids[0]);
    expect(queue.byId(ids[1])?.pages[0].words[0].hidden).toBe(false);
  });

  it('leaves categorisation for the server and accepts a user title retaining the visible report date', async () => {
    const { queue, extraction, create } = setup();
    extraction.extract.mockImplementation(async () => [
      {
        ...page(),
        words: ['Collected: 2026-10-15', 'TSH 2.1 mIU/L 0.4-4.0'].flatMap((line, row) =>
          line
            .split(' ')
            .map((text, col) => ({ id: row * 10 + col, text, line: row, hidden: false })),
        ),
      },
    ]);
    const [id] = queue.add([new File(['fictional'], 'first.txt')]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(queue.byId(id)?.name).toBe('Lab document 1');
    queue.rename(id, '2026-10-15 · Follow-up thyroid tests');
    expect(await queue.approve(id)).toBe(true);
    expect(create.mock.calls[0][0].name).toBe('2026-10-15 · Follow-up thyroid tests');
  });

  it('saves the sixth generated neutral title even when Lab and document are hidden on its page', async () => {
    const { queue, create, extraction } = setup();
    extraction.extract.mockImplementation(async () => [
      {
        ...page(),
        words: [
          { id: 1, text: 'Lab', line: 0, hidden: false },
          { id: 2, text: 'document', line: 0, hidden: false },
        ],
      },
    ]);
    const ids = queue.add(
      Array.from({ length: 6 }, (_, i) => new File(['fictional'], `report-${i + 1}.txt`)),
    );
    await settled(() => expect(ids.every((id) => queue.byId(id)?.status === 'review')).toBe(true));
    for (const id of ids.slice(0, 5)) expect(await queue.approve(id)).toBe(true);
    const sixth = ids[5];
    queue.toggleWord(sixth, 0, 1);
    queue.toggleWord(sixth, 0, 2);
    expect(queue.byId(sixth)?.name).toBe('Lab document 6');
    expect(await queue.approve(sixth)).toBe(true);
    expect(create).toHaveBeenCalledTimes(6);
    expect(queue.byId(sixth)?.status).toBe('saved');
    expect(create.mock.calls[5][0].name).toBe('Lab document 6');
    expect(create.mock.calls[5][0].pages[0].words.every((word) => word.t === null)).toBe(true);
    expect(create.mock.calls[5][0]).not.toHaveProperty('generatedName');
  });

  it('switches a running check and waiting files to lighter review without losing their pages', async () => {
    const { queue, ner, create } = setup();
    ner.predict.mockImplementationOnce(
      (_pages, abort) =>
        new Promise((resolve) =>
          abort?.addEventListener('abort', () => resolve([null]), { once: true }),
        ),
    );
    const ids = queue.add([new File(['TSH'], 'first.txt'), new File(['TSH'], 'second.txt')]);
    await settled(() => expect(ner.predict).toHaveBeenCalledOnce());
    queue.useLightweightReview();
    await settled(() => expect(ids.every((id) => queue.byId(id)?.status === 'review')).toBe(true));
    expect(queue.privacyMode()).toBe('lightweight');
    expect(ner.cancel).toHaveBeenCalledOnce();
    expect(ner.predict).toHaveBeenCalledOnce();
    for (const id of ids) {
      expect(queue.byId(id)?.pages).toHaveLength(1);
      expect(queue.byId(id)?.file).not.toBeNull();
      expect(queue.byId(id)?.privacyMode).toBe('lightweight');
      expect(queue.byId(id)?.privacyCheck).toBe('manual');
      expect(await queue.approve(id)).toBe(true);
    }
    expect(create).toHaveBeenCalledTimes(ids.length);
  });

  it('honors a mode switch during file reading and preserves masks during a cancelled recheck', async () => {
    const { queue, ner, extraction } = setup();
    let finish!: (pages: WorkingPage[]) => void;
    extraction.extract.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const [id] = queue.add([new File(['TSH'], 'report.txt')]);
    await settled(() => expect(extraction.extract).toHaveBeenCalledOnce());
    queue.useLightweightReview();
    finish([page()]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(ner.predict).not.toHaveBeenCalled();
    queue.toggleWord(id, 0, 1);
    queue.addRegion(id, 0, { x: 40, y: 40, w: 10, h: 10 });
    ner.predict.mockImplementationOnce(
      (_pages, abort) =>
        new Promise((resolve) =>
          abort?.addEventListener('abort', () => resolve([null]), { once: true }),
        ),
    );
    const recheck = queue.runAutomaticCheck(id);
    await settled(() => expect(ner.predict).toHaveBeenCalledOnce());
    queue.useLightweightReview();
    await recheck;
    expect(queue.byId(id)?.pages[0].words[0].hidden).toBe(true);
    expect(queue.byId(id)?.pages[0].regions).toHaveLength(1);
  });

  it('does not save a working document discarded while its approved pages are being prepared', async () => {
    const { queue, create } = setup();
    const [id] = queue.add(
      [new File(['TSH'], 'report.txt', { type: 'text/plain' })],
      'lightweight',
    );
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    const saving = queue.approve(id);
    queue.remove(id);
    expect(await saving).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(queue.documents()).toEqual([]);
  });

  it('never starts the large model in lightweight mode, even on retry, and saves with one approval', async () => {
    const { queue, create, ner } = setup();
    const [id] = queue.add(
      [new File(['TSH'], 'report.txt', { type: 'text/plain' })],
      'lightweight',
    );
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    await queue.rescan(id);
    expect(ner.load).not.toHaveBeenCalled();
    expect(ner.predict).not.toHaveBeenCalled();
    expect(ner.retry).not.toHaveBeenCalled();
    expect(queue.byId(id)?.privacyCheck).toBe('manual');
    expect(create).not.toHaveBeenCalled();
    expect(await queue.approve(id)).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });

  it('starts the full check only after a lightweight user explicitly upgrades', async () => {
    const { queue, ner } = setup();
    const [id] = queue.add(
      [new File(['TSH'], 'report.txt', { type: 'text/plain' })],
      'lightweight',
    );
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    await queue.runAutomaticCheck(id);
    expect(ner.predict).toHaveBeenCalledOnce();
    expect(queue.byId(id)?.privacyMode).toBe('automatic');
  });
  it('keeps the original filename for the local list without putting it in the approved manifest', async () => {
    const { queue, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'Jane_Doe_44051401359.txt', { type: 'text/plain' })]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(queue.byId(id)?.name).toBe('Lab document 1');
    expect(await queue.approve(id)).toBe(true);
    expect(JSON.stringify(create.mock.calls[0][0])).not.toMatch(/Jane|Doe|44051401359/);
    expect(create.mock.calls[0][2]).toBe('Jane_Doe_44051401359.txt');
    expect(queue.saved()?.[0].originalFileName).toBe('Jane_Doe_44051401359.txt');
  });

  it('marks a document incomplete when the check could not start and prevents Keep under an existing region', async () => {
    const { queue } = setup(true);
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(queue.byId(id)?.privacyCheck).toBe('incomplete');
    queue.addRegion(id, 0, { x: 0, y: 0, w: 30, h: 20 });
    queue.toggleWord(id, 0, 1);
    expect(toStoredPage(queue.byId(id)!.pages[0]).words[0].h).toBe(true);
  });

  it('blocks a manually entered title matching text that the user just hid', async () => {
    const { queue, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.toggleWord(id, 0, 1);
    queue.rename(id, 'TSH results');
    expect(await queue.approve(id)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(queue.byId(id)?.error).toContain('document name');
    queue.rename(id, 'Thyroid tests');
    expect(queue.byId(id)?.error).toBeUndefined();
    expect(await queue.approve(id)).toBe(true);
  });
});

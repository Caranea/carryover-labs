import { settled } from '../../testing/settled';
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionService } from '../extraction/extraction.service';
import { DocumentQueueService } from './document-queue.service';
import { LocalHistory } from './local-history';
import { ResultsService } from './results.service';
import type { DocumentManifest, WorkingPage } from './models';

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

function setup() {
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
  const extraction = {
    extract: vi.fn(async () => [page()]),
    extractSample: vi.fn(async () => [page()]),
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ExtractionService, useValue: extraction },
      { provide: ResultsService, useValue: api },
      { provide: LocalHistory, useValue: api },
    ],
  });
  return { queue: TestBed.inject(DocumentQueueService), create, api, extraction };
}

describe('document privacy boundary', () => {
  it('undoes and redoes hand edits in order, and a new edit clears redo', async () => {
    const { queue } = setup();
    const [id] = queue.add([new File(['fictional'], 'one.txt')]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    const regions = () => queue.byId(id)!.pages[0].regions;
    expect(queue.canUndo(id)).toBe(false);

    queue.addRegion(id, 0, { x: 40, y: 40, w: 10, h: 10 });
    queue.addRegion(id, 0, { x: 60, y: 60, w: 10, h: 10 });
    expect(regions()).toHaveLength(2);

    queue.undo(id);
    expect(regions()).toHaveLength(1);
    queue.undo(id);
    expect(regions()).toHaveLength(0);
    expect(queue.canUndo(id)).toBe(false);

    queue.redo(id);
    expect(regions()).toHaveLength(1);
    expect(queue.canRedo(id)).toBe(true);
    queue.removeRegion(id, 0, 5); // No such region: not an edit, redo survives.
    expect(queue.canRedo(id)).toBe(true);
    queue.addRegion(id, 0, { x: 10, y: 10, w: 10, h: 10 });
    expect(queue.canRedo(id)).toBe(false);
    expect(queue.lastEdited()).toBe(id);

    queue.remove(id);
    expect(queue.canUndo(id)).toBe(false);
    expect(queue.lastEdited()).toBe(null);
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

  it('does not save a working document discarded while its approved pages are being prepared', async () => {
    const { queue, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })]);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    const saving = queue.approve(id);
    queue.remove(id);
    expect(await saving).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(queue.documents()).toEqual([]);
  });

  it('reads a sample patient document from its pages and saves it marked as a sample', async () => {
    const { queue, create, extraction } = setup();
    const [id] = queue.addSamples(['jane-doe-lab-10']);
    await settled(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(extraction.extract).not.toHaveBeenCalled();
    expect(extraction.extractSample).toHaveBeenCalledOnce();
    const [pages] = extraction.extractSample.mock.calls[0] as unknown as [{ src: string }[]];
    expect(pages[0].src).toBe('samples/jane-doe/jane-doe-lab-10-p1.webp');
    expect(queue.byId(id)?.fileName).toBe('Jane_Doe_lab_10.pdf');
    expect(await queue.approve(id)).toBe(true);
    expect(create.mock.calls[0]).toEqual([
      expect.anything(),
      expect.anything(),
      'Jane_Doe_lab_10.pdf',
      id,
      'jane-doe-lab-10',
    ]);
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
});

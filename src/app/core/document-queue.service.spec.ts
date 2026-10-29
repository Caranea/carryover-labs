import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { ExtractionService } from '../extraction/extraction.service';
import { NerService } from '../pii/ner.service';
import { DocumentQueueService } from './document-queue.service';
import { DocumentsApi } from './documents-api';
import type { DocumentManifest, WorkingPage } from './models';
import { toStoredPage } from '../redaction/burn';

const page = (): WorkingPage => ({ index: 0, width: 100, height: 100, image: null, imageUrl: null, ocr: false, regions: [], words: [
  { id: 1, text: 'TSH', line: 0, hidden: false, box: { x: 5, y: 5, w: 20, h: 10 } },
] });

function setup(incomplete = false) {
  const create = vi.fn(async (manifest: DocumentManifest) => ({ id: 'saved', ...manifest, pageCount: manifest.pages.length, createdAt: '', updatedAt: '' }));
  const api = { create, list: vi.fn(async () => []), get: vi.fn(), pageImage: vi.fn() };
  const extraction = { extract: vi.fn(async () => [page()]) };
  const ner = { load: vi.fn(async () => true), predict: vi.fn(async () => incomplete ? [null] : [new Map([[1, { label: 'O', score: 1 }]])]), retry: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: ExtractionService, useValue: extraction },
    { provide: NerService, useValue: ner },
    { provide: DocumentsApi, useValue: api },
  ] });
  return { queue: TestBed.inject(DocumentQueueService), create, ner, api, extraction };
}

describe('document privacy boundary', () => {
  it('does not save a working document discarded while its approved pages are being prepared', async () => {
    const { queue, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.acknowledgePrivacy(id, true);
    const saving = queue.approve(id);
    queue.remove(id);
    expect(await saving).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(queue.documents()).toEqual([]);
  });

  it('never starts the large model in lightweight mode, even on retry, and requires acknowledgement', async () => {
    const { queue, create, ner } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    await queue.rescan(id);
    expect(ner.load).not.toHaveBeenCalled();
    expect(ner.predict).not.toHaveBeenCalled();
    expect(ner.retry).not.toHaveBeenCalled();
    expect(queue.byId(id)?.privacyCheck).toBe('incomplete');
    expect(queue.byId(id)?.privacyMessage).toContain('not run');
    expect(await queue.approve(id)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    queue.acknowledgePrivacy(id, true);
    expect(await queue.approve(id)).toBe(true);
  });

  it('starts the full check only after a lightweight user explicitly upgrades', async () => {
    const { queue, ner } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.acknowledgePrivacy(id, true);
    await queue.runAutomaticCheck(id);
    expect(ner.predict).toHaveBeenCalledOnce();
    expect(queue.byId(id)?.privacyMode).toBe('automatic');
    expect(queue.byId(id)?.privacyAcknowledged).toBe(false);
  });
  it('never derives an uploaded title from a filename containing personal details', async () => {
    const { queue, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'Jane_Doe_44051401359.txt', { type: 'text/plain' })]);
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(queue.byId(id)?.name).toBe('Lab document 1');
    expect(await queue.approve(id)).toBe(true);
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/Jane|Doe|44051401359/);
  });

  it('retains a per-document incomplete warning and prevents Keep under an existing region', async () => {
    const { queue } = setup(true);
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })]);
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(queue.byId(id)?.privacyCheck).toBe('incomplete');
    queue.addRegion(id, 0, { x: 0, y: 0, w: 30, h: 20 });
    queue.toggleWord(id, 0, 1);
    expect(toStoredPage(queue.byId(id)!.pages[0]).words[0].h).toBe(true);
  });

  it('blocks a manually entered title matching text that the user just hid', async () => {
    const { queue, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })]);
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.toggleWord(id, 0, 1);
    queue.rename(id, 'TSH results');
    expect(await queue.approve(id)).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(queue.byId(id)?.error).toContain('document name');
  });
});

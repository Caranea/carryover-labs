import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
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
  const auth = { userId: signal<string | null>('account-a'), sessionRevision: signal(0) };
  const create = vi.fn(async (manifest: DocumentManifest) => ({ id: 'saved', ...manifest, pageCount: manifest.pages.length, createdAt: '', updatedAt: '' }));
  const api = { create, list: vi.fn(async () => []), get: vi.fn(), pageImage: vi.fn() };
  const extraction = { extract: vi.fn(async () => [page()]) };
  const ner = { load: vi.fn(async () => true), predict: vi.fn(async () => incomplete ? [null] : [new Map([[1, { label: 'O', score: 1 }]])]), retry: vi.fn() };
  TestBed.configureTestingModule({ providers: [
    { provide: AuthService, useValue: auth },
    { provide: ExtractionService, useValue: extraction },
    { provide: NerService, useValue: ner },
    { provide: DocumentsApi, useValue: api },
  ] });
  return { queue: TestBed.inject(DocumentQueueService), create, ner, auth, api, extraction };
}

describe('document privacy boundary', () => {
  it('clears local originals and saved summaries when the account changes', async () => {
    const { queue, auth } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.saved.set([]);
    auth.userId.set('account-b');
    TestBed.tick();
    expect(queue.documents()).toEqual([]);
    expect(queue.saved()).toBeNull();
    expect(await queue.approve(id)).toBe(false);
  });

  it('does not repopulate a previous account from a late list or page response', async () => {
    const { queue, auth, api } = setup();
    let finishList!: (value: never[]) => void;
    api.list.mockImplementation(() => new Promise((resolve) => { finishList = resolve; }));
    let finishImage!: (value: Blob) => void;
    api.get.mockResolvedValue({ id: 'saved', name: 'Old account record', sourceKind: 'image', pages: [
      { index: 0, width: 100, height: 100, hasImage: true, ocr: false, words: [], regions: [] },
    ] });
    api.pageImage.mockImplementation(() => new Promise((resolve) => { finishImage = resolve; }));
    const listing = queue.refreshSaved();
    const opening = queue.openSaved('saved');
    const rejected = expect(opening).rejects.toThrow('account changed');
    await vi.waitFor(() => expect(api.pageImage).toHaveBeenCalledOnce());
    auth.userId.set('account-b');
    finishList([]);
    finishImage(new Blob(['old account page']));
    await listing;
    await rejected;
    expect(queue.saved()).toBeNull();
    expect(queue.documents()).toEqual([]);
  });

  it('does not submit a prepared document after the account changes during rendering', async () => {
    const { queue, auth, create } = setup();
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.acknowledgePrivacy(id, true);
    const saving = queue.approve(id);
    auth.userId.set('account-b');
    expect(await saving).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(queue.documents()).toEqual([]);
  });

  it('does not retain a late upload response in the next account', async () => {
    const { queue, auth, create } = setup();
    let finish!: (value: Awaited<ReturnType<typeof create>>) => void;
    create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const [id] = queue.add([new File(['TSH'], 'report.txt', { type: 'text/plain' })], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    queue.acknowledgePrivacy(id, true);
    const saving = queue.approve(id);
    await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
    auth.userId.set('account-b');
    finish({ ...create.mock.calls[0][0], id: 'saved', pageCount: 1, createdAt: '', updatedAt: '' });
    expect(await saving).toBe(false);
    expect(queue.saved()).toBeNull();
    expect(queue.documents()).toEqual([]);
  });

  it('rejects a late response when the user returns to the same account after switching', async () => {
    const { queue, auth, api } = setup();
    let finish!: (value: never[]) => void;
    api.list.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const listing = queue.refreshSaved();
    // Clerk observes A → B → A synchronously; Angular need not render the intermediate B.
    auth.sessionRevision.set(2);
    finish([]);
    await listing;
    expect(queue.saved()).toBeNull();
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

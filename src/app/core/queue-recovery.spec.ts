import 'fake-indexeddb/auto';
import { Blob as NativeBlob, File as NativeFile } from 'node:buffer';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { resultsReadyGuard } from './results-ready.guard';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deviceTransaction } from './device-storage';
import { QueueRecovery, QUEUE_PROGRESS_KEY, type QueueSnapshot } from './queue-recovery';
import { DocumentQueueService } from './document-queue.service';
import { DocumentsApi } from './documents-api';
import { ExtractionService } from '../extraction/extraction.service';
import { NerService } from '../pii/ner.service';
import { LOCAL_HISTORY_KEY } from './local-history';
import type { LocalDocument } from './models';
import { PRIVACY_VERSION } from '../pii/detect';

function document(id = 'one', status: LocalDocument['status'] = 'review'): LocalDocument {
  return { localId: id, name: 'Lab document 6', generatedName: 'Lab document 6', fileName: `${id}.txt`,
    sourceKind: 'text', status, strict: false, progress: 1, message: '', addedAt: 1,
    privacyMode: 'lightweight', privacyCheck: 'manual', privacyAcknowledged: true,
    file: new File(['fictional original'], `${id}.txt`, { type: 'text/plain' }),
    pages: status === 'queued' || status === 'reading' ? [] : [{ index: 0, width: 100, height: 100,
      image: null, imageUrl: null, ocr: false, regions: [{ x: 60, y: 60, w: 10, h: 10 }],
      words: [{ id: 1, text: 'Fictional', line: 0, hidden: true, userSet: true, source: 'you' }] }] };
}
function snapshot(documents: LocalDocument[] = [document()]): QueueSnapshot {
  return { documents, batchIds: documents.map(d => d.localId), reviewId: documents[0]?.localId ?? null,
    reviewOpened: true, counter: 6, privacyMode: 'lightweight', privacyModeChosen: true };
}
function queueSetup() {
  const extraction = { extract: vi.fn(async () => document().pages) };
  const ner = { predict: vi.fn(async () => []), error: () => null, checkProgress: () => 0 };
  TestBed.configureTestingModule({ providers: [
    provideRouter([]),
    { provide: ExtractionService, useValue: extraction }, { provide: NerService, useValue: ner }, DocumentsApi,
  ] });
  return { queue: TestBed.inject(DocumentQueueService), extraction, ner };
}

describe('queue recovery after refresh', () => {
  beforeEach(async () => {
    vi.stubGlobal('Blob', NativeBlob); vi.stubGlobal('File', NativeFile);
    localStorage.removeItem(QUEUE_PROGRESS_KEY); localStorage.removeItem(LOCAL_HISTORY_KEY);
    await deviceTransaction(['queue-state', 'queue-documents', 'approved-images'], 'readwrite', tx => {
      for (const store of ['queue-state', 'queue-documents', 'approved-images']) tx.objectStore(store).clear();
    });
  });
  afterEach(() => { TestBed.resetTestingModule(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  it('rechecks legacy automatic masks from saved OCR, discards untrusted memory and keeps hand edits', async () => {
    const source = document('source');
    source.privacyMode = 'automatic'; source.privacyCheck = 'complete';
    source.pages[0].words = [
      { id: 0, text: 'Coeliac', line: 0, hidden: true, source: 'rule', kind: 'person' },
      { id: 1, text: 'Jane', line: 1, hidden: true, userSet: true, source: 'you' },
      { id: 2, text: 'Doe', line: 1, hidden: false, userSet: true },
    ];
    const next = document('next');
    next.pages[0].words = [{ id: 0, text: 'coeliac', line: 0, hidden: true, source: 'remembered', kind: 'person' }];
    const state = snapshot([source, next]);
    state.rememberedDetails = { obsolete: [{ key: 'coeliac', kind: 'person' }] };
    const writer = new QueueRecovery(); await writer.load(); await writer.save(state);
    const { queue, extraction, ner } = queueSetup();
    await queue.ready;
    await vi.waitFor(() => expect(queue.byId('source')?.status).toBe('review'));
    expect(extraction.extract).not.toHaveBeenCalled();
    expect(ner.predict).toHaveBeenCalledTimes(1);
    expect(queue.byId('source')?.pages[0].words.map(w => w.hidden)).toEqual([false, true, false]);
    expect(queue.byId('source')?.pages[0].regions).toEqual(source.pages[0].regions);
    expect(queue.byId('source')?.privacyVersion).toBe(PRIVACY_VERSION);
    expect(queue.byId('next')?.pages[0].words[0].hidden).toBe(false);
    await queue.retryRecovery();
    TestBed.resetTestingModule();
    const restored = queueSetup(); await restored.queue.ready;
    expect(restored.ner.predict).not.toHaveBeenCalled();
    expect(restored.extraction.extract).not.toHaveBeenCalled();
    expect(restored.queue.byId('source')?.pages[0].words[1]).toMatchObject({ hidden: true, userSet: true });
    await restored.queue.retryRecovery();
  });

  it('restores files and edits while keeping large images out of localStorage', async () => {
    const state = snapshot();
    state.documents[0].pages[0].image = new Blob([new Uint8Array(6 * 1024 * 1024)], { type: 'image/png' });
    state.documents[0].pages[0].imageUrl = 'blob:old-tab';
    const writer = new QueueRecovery(); await writer.load(); await writer.save(state);
    const marker = localStorage.getItem(QUEUE_PROGRESS_KEY)!;
    expect(marker.length).toBeLessThan(2000); expect(marker).not.toContain('Fictional');
    const restored = (await new QueueRecovery().load())!;
    expect(restored.reviewId).toBe('one'); expect(restored.reviewOpened).toBe(true);
    expect(await restored.documents[0].file!.text()).toBe('fictional original');
    expect(restored.documents[0].pages[0]).toMatchObject({ imageUrl: null, regions: state.documents[0].pages[0].regions, words: state.documents[0].pages[0].words });
    expect(restored.documents[0].pages[0].image!.size).toBe(6 * 1024 * 1024);
    expect(restored.documents[0].privacyAcknowledged).toBe(true);
  });

  it('restores remembered details from an approved source for a new manual file without putting them in the progress marker', async () => {
    const source = { ...document('source', 'saved'), serverId: 'approved', pages: [], file: null };
    const state = snapshot([source]);
    state.rememberedDetails = { source: [{ key: 'alexandra', kind: 'person' }] };
    state.rememberedDetailsVersion = PRIVACY_VERSION;
    const writer = new QueueRecovery(); await writer.load(); await writer.save(state);
    expect(localStorage.getItem(QUEUE_PROGRESS_KEY)).not.toContain('alexandra');
    expect((await new QueueRecovery().load())?.rememberedDetails).toEqual(state.rememberedDetails);
    const { queue, extraction } = queueSetup(); await queue.ready;
    extraction.extract.mockImplementation(async () => [{ ...document().pages[0], regions: [], words: [{ id: 1, text: 'ALEXANDRA', line: 0, hidden: false }] }]);
    const [id] = queue.add([new File(['fictional'], 'next.txt')], 'lightweight');
    await vi.waitFor(() => expect(queue.byId(id)?.status).toBe('review'));
    expect(queue.byId(id)?.pages[0].words[0]).toMatchObject({ hidden: true, source: 'remembered' });
    await queue.retryRecovery();
  });

  it('coalesces rapid edits and never restores removed or approved originals', async () => {
    const writer = new QueueRecovery(); await writer.load();
    const initial = snapshot([document('one'), document('two')]);
    const saving = writer.save(initial);
    const final = snapshot([{ ...initial.documents[0], name: 'Thyroid tests', status: 'saved', pages: [], file: null, serverId: 'approved' }]);
    await writer.save(final); await saving;
    expect(writer.isSaved(final)).toBe(true);
    const restored = (await new QueueRecovery().load())!;
    expect(restored.documents).toHaveLength(1); expect(restored.documents[0]).toMatchObject({ name: 'Thyroid tests', file: null, pages: [], status: 'saved' });
    const count = await deviceTransaction<number>(['queue-documents'], 'readonly', (tx, result) => {
      const request = tx.objectStore('queue-documents').count(); request.onsuccess = () => result(request.result);
    });
    expect(count).toBe(1);
  });

  it('keeps the previous checkpoint after a quota failure and supports retry', async () => {
    const writer = new QueueRecovery(); await writer.load(); const initial = snapshot(); await writer.save(initial);
    const changed = snapshot([{ ...initial.documents[0], name: 'Thyroid tests' }]);
    const fail = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    await expect(writer.save(changed)).rejects.toThrow('Full'); fail.mockRestore();
    expect(writer.status()).toBe('error'); expect(writer.error()).toContain('storage is full');
    expect((await new QueueRecovery().load())!.documents[0].name).toBe('Lab document 6');
    await writer.save(changed); expect(writer.status()).toBe('saved');
    expect((await new QueueRecovery().load())!.documents[0].name).toBe('Thyroid tests');
  });

  it('does not let a stale second tab overwrite newer progress', async () => {
    const first = new QueueRecovery(); const second = new QueueRecovery(); await first.load(); await second.load();
    await first.save(snapshot());
    await expect(second.save(snapshot([document('different')]))).rejects.toThrow('Another tab');
    expect((await new QueueRecovery().load())!.documents[0].localId).toBe('one');
  });

  it('reopens the selected review and resumes interrupted files without repeating completed OCR', async () => {
    const writer = new QueueRecovery(); await writer.load();
    const docs = [document('ready'), document('reading', 'reading'), document('detecting', 'detecting')];
    await writer.save(snapshot(docs));
    const { queue, extraction, ner } = queueSetup(); await queue.ready;
    await vi.waitFor(() => expect(queue.documents().every(d => d.status === 'review')).toBe(true));
    expect(extraction.extract).toHaveBeenCalledOnce(); expect(ner.predict).not.toHaveBeenCalled();
    expect(queue.reviewOpened()).toBe(true); expect(queue.reviewId()).toBe('ready');
    expect(queue.byId('ready')?.pages[0].words[0]).toMatchObject({ hidden: true, userSet: true });
    expect(queue.byId('ready')?.privacyAcknowledged).toBe(true);
    expect(queue.resultsBlocked()).toBe(true);
    await queue.retryRecovery();
  });

  it('recognizes an approval committed just before refresh, without creating a duplicate', async () => {
    const writer = new QueueRecovery(); await writer.load(); await writer.save(snapshot([document('one', 'saving')]));
    const api = new DocumentsApi();
    const saved = await api.create({ name: 'Lab document 6', sourceKind: 'text', hiddenCount: 0, pages: [] }, [], 'one.txt', 'one');
    const { queue } = queueSetup(); await queue.ready;
    expect(queue.byId('one')).toMatchObject({ status: 'saved', serverId: saved.id, file: null, pages: [] });
    expect(queue.resultsBlocked()).toBe(false); expect(await api.list()).toHaveLength(1);
    await queue.retryRecovery();
  });

  it('restores an uncommitted approval as reviewable with its edits intact', async () => {
    const writer = new QueueRecovery(); await writer.load(); await writer.save(snapshot([document('one', 'saving')]));
    const { queue } = queueSetup(); await queue.ready;
    expect(queue.byId('one')).toMatchObject({ status: 'review', privacyAcknowledged: true });
    expect(queue.byId('one')?.pages[0].words[0].hidden).toBe(true);
    await queue.retryRecovery();
  });

  it('warns before leaving with an edit not yet checkpointed, including before the saving effect runs', async () => {
    const writer = new QueueRecovery(); await writer.load(); await writer.save(snapshot());
    const { queue } = queueSetup(); await queue.ready; await queue.retryRecovery();
    queue.rename('one', 'Thyroid tests');
    const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    await queue.retryRecovery();
    const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });

  it('blocks new uploads rather than overwriting a checkpoint that cannot be restored', async () => {
    await deviceTransaction(['queue-state'], 'readwrite', tx => { tx.objectStore('queue-state').put({ version: 99, ids: ['one'] }, 'active'); });
    const { queue } = queueSetup(); await queue.ready;
    expect(queue.recoveryReady()).toBe(false); expect(queue.resultsBlocked()).toBe(true);
    expect(queue.recovery.error()).toContain('files have been kept');
    expect(queue.add([new File(['new'], 'new.txt')])).toEqual([]);
    const version = await deviceTransaction<number>(['queue-state'], 'readonly', (tx, result) => {
      const request = tx.objectStore('queue-state').get('active'); request.onsuccess = () => result(request.result.version);
    });
    expect(version).toBe(99);
  });

  it('allows a direct Results reload after waiting for an empty queue to restore', async () => {
    const { queue } = queueSetup();
    expect(queue.recoveryReady()).toBe(false);
    const allowed = TestBed.runInInjectionContext(() => resultsReadyGuard({} as never, {} as never));
    expect(await allowed).toBe(true);
    await queue.retryRecovery();
  });
});

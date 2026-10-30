import { Injectable, signal } from '@angular/core';
import type { LocalDocument, PrivacyMode } from './models';
import { deviceTransaction } from './device-storage';
import type { RememberedDetails } from '../pii/remembered-details';

export const QUEUE_PROGRESS_KEY = 'carryover.queue.progress.v1';
export interface QueueSnapshot {
  documents: LocalDocument[];
  batchIds: string[];
  reviewId: string | null;
  reviewOpened: boolean;
  privacyMode: PrivacyMode;
  privacyModeChosen: boolean;
  counter: number;
  rememberedDetails?: RememberedDetails;
  rememberedDetailsVersion?: number;
}
interface QueueHead extends Omit<QueueSnapshot, 'documents'> { version: 1; revision: string; ids: string[] }

/** Ignore transient OCR percentages; save every file, edit and workflow transition. */
function sameDocument(a: LocalDocument | undefined, b: LocalDocument): boolean {
  return !!a && a.localId === b.localId && a.file === b.file && a.pages === b.pages && a.status === b.status
    && a.name === b.name && a.generatedName === b.generatedName && a.serverId === b.serverId
    && a.strict === b.strict && a.privacyMode === b.privacyMode && a.privacyCheck === b.privacyCheck && a.privacyVersion === b.privacyVersion
    && a.privacyMessage === b.privacyMessage && a.privacyAcknowledged === b.privacyAcknowledged && a.error === b.error;
}
function metadata(snapshot: QueueSnapshot): string {
  const { documents, ...state } = snapshot;
  return JSON.stringify({ ...state, ids: documents.map(doc => doc.localId) });
}
function equal(a: QueueSnapshot | undefined, b: QueueSnapshot): boolean {
  return !!a && metadata(a) === metadata(b) && a.documents.length === b.documents.length
    && a.documents.every((doc, index) => sameDocument(doc, b.documents[index]));
}

@Injectable({ providedIn: 'root' })
export class QueueRecovery {
  readonly status = signal<'loading' | 'saving' | 'saved' | 'error' | 'unavailable'>('loading');
  readonly error = signal<string | null>(null);
  private revision: string | undefined;
  private stored: QueueSnapshot | undefined;
  private latest: QueueSnapshot | undefined;
  private writing: Promise<void> | undefined;
  readonly available = typeof indexedDB !== 'undefined';

  isSaved(snapshot: QueueSnapshot): boolean {
    return this.status() === 'saved' && equal(this.stored, snapshot);
  }

  async load(): Promise<QueueSnapshot | null> {
    if (!this.available) { this.status.set('unavailable'); return null; }
    try {
      const loaded = await deviceTransaction<{ head?: QueueHead; docs: LocalDocument[] }>(['queue-state', 'queue-documents'], 'readonly', (tx, result, fail) => {
        const request = tx.objectStore('queue-state').get('active');
        request.onsuccess = () => {
          const head = request.result as QueueHead | undefined;
          if (!head) { result({ docs: [] }); return; }
          if (head.version !== 1 || typeof head.revision !== 'string' || !Array.isArray(head.ids)
            || !head.ids.every(id => typeof id === 'string') || new Set(head.ids).size !== head.ids.length
            || !Array.isArray(head.batchIds) || !head.batchIds.every(id => typeof id === 'string')
            || !Number.isSafeInteger(head.counter) || head.counter < 0
            || typeof head.reviewOpened !== 'boolean' || !(head.reviewId === null || typeof head.reviewId === 'string')
            || !['automatic', 'lightweight'].includes(head.privacyMode) || typeof head.privacyModeChosen !== 'boolean'
            || !validRememberedDetails(head.rememberedDetails)) {
            fail(new Error('The saved queue could not be read. Its files have been kept.')); return;
          }
          const docs: LocalDocument[] = [];
          if (!head.ids.length) { result({ head, docs }); return; }
          let remaining = head.ids.length;
          head.ids.forEach((id, index) => {
            const item = tx.objectStore('queue-documents').get(id);
            item.onsuccess = () => {
              const doc = item.result as LocalDocument | undefined;
              if (!doc || doc.localId !== id || !Array.isArray(doc.pages) || typeof doc.name !== 'string' || typeof doc.fileName !== 'string'
                || !['queued', 'reading', 'detecting', 'review', 'saving', 'saved', 'error'].includes(doc.status)) {
                fail(new Error('A saved queue file could not be read. Its data has been kept.')); return;
              }
              docs[index] = doc;
              if (--remaining === 0) result({ head, docs });
            };
          });
        };
      });
      this.revision = loaded.head?.revision;
      this.status.set('saved');
      this.error.set(null);
      if (!loaded.head) return null;
      const { ids: _ids, version: _version, revision: _revision, ...state } = loaded.head;
      this.stored = { ...state, documents: loaded.docs };
      return this.stored;
    } catch (error) { this.failed(error); throw error; }
  }

  save(snapshot: QueueSnapshot): Promise<void> {
    if (!this.available) return Promise.resolve();
    if (equal(this.latest ?? this.stored, snapshot) && this.status() !== 'error') return this.writing ?? Promise.resolve();
    this.latest = snapshot;
    this.status.set('saving'); this.error.set(null);
    if (!this.writing) this.writing = this.drain();
    return this.writing;
  }

  private async drain() {
    try {
      while (this.latest) {
        const snapshot = this.latest; this.latest = undefined;
        const oldDocs = new Map(this.stored?.documents.map(doc => [doc.localId, doc]));
        const nextRevision = crypto.randomUUID();
        const { documents, ...state } = snapshot;
        const head: QueueHead = { ...state, version: 1, revision: nextRevision, ids: documents.map(doc => doc.localId) };
        await deviceTransaction<void>(['queue-state', 'queue-documents'], 'readwrite', (tx, _result, fail) => {
          const heads = tx.objectStore('queue-state');
          const request = heads.get('active');
          request.onsuccess = () => {
            try {
              if (request.result?.revision !== this.revision) { fail(new Error('Another tab changed this queue. Keep this tab open and finish in one tab.')); return; }
              const store = tx.objectStore('queue-documents');
              for (const doc of documents) {
                if (!sameDocument(oldDocs.get(doc.localId), doc)) {
                  // Blob URLs belong to the old page; rebuild them after a refresh.
                  store.put({ ...doc, pages: doc.pages.map(page => ({ ...page, imageUrl: null })) }, doc.localId);
                }
              }
              for (const id of (request.result?.ids ?? []) as string[]) if (!head.ids.includes(id)) store.delete(id);
              heads.put(head, 'active');
            } catch (error) { fail(error instanceof Error || error instanceof DOMException ? error : new Error(String(error))); }
          };
        });
        this.revision = nextRevision; this.stored = snapshot;
        // Small progress checkpoint only. Files and page text stay in IndexedDB.
        const { rememberedDetails: _privateDetails, ...progress } = head;
        localStorage.setItem(QUEUE_PROGRESS_KEY, JSON.stringify({ ...progress,
          documents: documents.map(({ localId, fileName, status }) => ({ localId, fileName, status })) }));
      }
      this.status.set('saved');
    } catch (error) { this.failed(error); throw error; }
    finally { this.writing = undefined; }
  }

  failed(error: unknown) {
    this.status.set('error');
    this.error.set(error instanceof DOMException && error.name === 'QuotaExceededError'
      ? 'Device storage is full. Keep this tab open, free some space and retry saving progress.'
      : error instanceof Error ? error.message : 'Progress could not be saved on this device. Keep this tab open and retry.');
  }
}

function validRememberedDetails(value: unknown): boolean {
  if (value === undefined) return true; // Older checkpoints did not remember details.
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.values(value).every(details => Array.isArray(details) && details.every(detail => detail
      && typeof detail.key === 'string' && detail.key.length > 0 && detail.key.length <= 200
      && ['person', 'address', 'national-id', 'id-number', 'contact', 'birth-date', 'age', 'other'].includes(detail.kind)));
}

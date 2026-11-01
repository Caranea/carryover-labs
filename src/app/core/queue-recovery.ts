import { Injectable, signal } from '@angular/core';
import type { LocalDocument, PrivacyMode } from './models';
import { deviceTransaction } from './device-storage';
import type { RememberedDetails } from '../pii/remembered-details';

export const QUEUE_PROGRESS_KEY = 'carryover.queue.progress.v1';
const QUEUE_LOCK = 'carryover.queue';
export interface QueueSnapshot {
  batchId?: string;
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
interface QueueHead extends Omit<QueueSnapshot, 'documents'> {
  version: 1;
  ids: string[];
}

/** Ignore transient OCR percentages; save every file, edit and workflow transition. */
function sameDocument(a: LocalDocument | undefined, b: LocalDocument): boolean {
  return (
    !!a &&
    a.localId === b.localId &&
    a.file === b.file &&
    a.pages === b.pages &&
    a.status === b.status &&
    a.name === b.name &&
    a.generatedName === b.generatedName &&
    a.serverId === b.serverId &&
    a.strict === b.strict &&
    a.privacyMode === b.privacyMode &&
    a.privacyCheck === b.privacyCheck &&
    a.privacyVersion === b.privacyVersion &&
    a.error === b.error
  );
}
function metadata(snapshot: QueueSnapshot): string {
  const { documents, ...state } = snapshot;
  return JSON.stringify({ ...state, ids: documents.map((doc) => doc.localId) });
}
function equal(a: QueueSnapshot | undefined, b: QueueSnapshot): boolean {
  return (
    !!a &&
    metadata(a) === metadata(b) &&
    a.documents.length === b.documents.length &&
    a.documents.every((doc, index) => sameDocument(doc, b.documents[index]))
  );
}

/**
 * Saves the queue on this device. One tab owns the saved queue at a time: another copy of
 * the page (a second tab, or the old page during a reload) waits until it closes, so two
 * pages never write over each other.
 */
@Injectable({ providedIn: 'root' })
export class QueueRecovery {
  readonly status = signal<'loading' | 'saving' | 'saved' | 'error' | 'unavailable'>('loading');
  readonly error = signal<string | null>(null);
  /** True while another tab holds the saved queue. */
  readonly otherTab = signal(false);
  private noticed: () => void = () => {};
  /** Settles when this page starts waiting for another tab. */
  readonly blocked = new Promise<void>((resolve) => (this.noticed = resolve));
  private owned: Promise<void> | undefined;
  private stored: QueueSnapshot | undefined;
  private latest: QueueSnapshot | undefined;
  private writing: Promise<void> | undefined;
  private loading: Promise<QueueSnapshot | null> | undefined;
  readonly available = typeof indexedDB !== 'undefined';

  isSaved(snapshot: QueueSnapshot): boolean {
    return this.status() === 'saved' && equal(this.stored, snapshot);
  }

  load(): Promise<QueueSnapshot | null> {
    if (!this.loading)
      this.loading = (async () => {
        await this.own();
        await this.writing;
        return this.readCheckpoint();
      })().finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  /**
   * Restoring rebuilds File objects and image URLs. That is not a change, so the restored
   * documents count as saved and are not written again.
   */
  restored(snapshot: QueueSnapshot) {
    if (!this.stored) return;
    const loaded = new Map(this.stored.documents.map((doc) => [doc.localId, doc]));
    this.stored = {
      ...this.stored,
      documents: snapshot.documents.map((doc) => {
        const before = loaded.get(doc.localId);
        return before && sameDocument(before, { ...doc, file: before.file, pages: before.pages })
          ? doc
          : (before ?? doc);
      }),
    };
  }

  /** Wait for this tab to own the saved queue; the lock is released when the page closes. */
  private own(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve();
    this.owned ??= new Promise<void>((owned) => {
      // A reload releases the old page's lock almost at once; only a real tab waits longer.
      const notice = setTimeout(() => {
        this.otherTab.set(true);
        this.noticed();
      }, 2000);
      void navigator.locks.request(QUEUE_LOCK, () => {
        clearTimeout(notice);
        this.otherTab.set(false);
        owned();
        return new Promise<never>(() => {});
      });
    });
    return this.owned;
  }

  private async readCheckpoint(): Promise<QueueSnapshot | null> {
    if (!this.available) {
      this.status.set('unavailable');
      return null;
    }
    try {
      const loaded = await deviceTransaction<{ head?: QueueHead; docs: LocalDocument[] }>(
        ['queue-state', 'queue-documents'],
        'readonly',
        (tx, result, fail) => {
          const request = tx.objectStore('queue-state').get('active');
          request.onsuccess = () => {
            const head = request.result as QueueHead | undefined;
            if (!head) {
              result({ docs: [] });
              return;
            }
            if (
              head.version !== 1 ||
              !Array.isArray(head.ids) ||
              !head.ids.every((id) => typeof id === 'string') ||
              new Set(head.ids).size !== head.ids.length ||
              !Array.isArray(head.batchIds) ||
              !head.batchIds.every((id) => typeof id === 'string') ||
              !Number.isSafeInteger(head.counter) ||
              head.counter < 0 ||
              typeof head.reviewOpened !== 'boolean' ||
              !(head.reviewId === null || typeof head.reviewId === 'string') ||
              !['automatic', 'lightweight'].includes(head.privacyMode) ||
              typeof head.privacyModeChosen !== 'boolean' ||
              !validRememberedDetails(head.rememberedDetails)
            ) {
              fail(new Error('The saved queue could not be read. Its files have been kept.'));
              return;
            }
            const docs: LocalDocument[] = [];
            if (!head.ids.length) {
              result({ head, docs });
              return;
            }
            let remaining = head.ids.length;
            head.ids.forEach((id, index) => {
              const item = tx.objectStore('queue-documents').get(id);
              item.onsuccess = () => {
                const doc = item.result as LocalDocument | undefined;
                if (
                  !doc ||
                  doc.localId !== id ||
                  !Array.isArray(doc.pages) ||
                  typeof doc.name !== 'string' ||
                  typeof doc.fileName !== 'string' ||
                  ![
                    'queued',
                    'reading',
                    'detecting',
                    'review',
                    'saving',
                    'saved',
                    'error',
                  ].includes(doc.status)
                ) {
                  fail(new Error('A saved queue file could not be read. Its data has been kept.'));
                  return;
                }
                docs[index] = doc;
                if (--remaining === 0) result({ head, docs });
              };
            });
          };
        },
      );
      this.status.set('saved');
      this.error.set(null);
      if (!loaded.head) return null;
      // `revision` is left over from older checkpoints.
      const {
        ids: _ids,
        version: _version,
        revision: _revision,
        ...state
      } = loaded.head as QueueHead & { revision?: string };
      this.stored = { ...state, documents: loaded.docs };
      return this.stored;
    } catch (error) {
      this.failed(error);
      throw error;
    }
  }

  save(snapshot: QueueSnapshot): Promise<void> {
    if (!this.available) return Promise.resolve();
    if (equal(this.latest ?? this.stored, snapshot) && this.status() !== 'error')
      return this.writing ?? Promise.resolve();
    this.latest = snapshot;
    this.status.set('saving');
    this.error.set(null);
    if (!this.writing) this.writing = this.drain();
    return this.writing;
  }

  private async drain() {
    try {
      // A restore in progress would replace what this save compares against: let it finish.
      await this.loading;
      while (this.latest) {
        const snapshot = this.latest;
        this.latest = undefined;
        const oldDocs = new Map(this.stored?.documents.map((doc) => [doc.localId, doc]));
        const { documents, ...state } = snapshot;
        const head: QueueHead = { ...state, version: 1, ids: documents.map((doc) => doc.localId) };
        await deviceTransaction<void>(
          ['queue-state', 'queue-documents'],
          'readwrite',
          (tx, _result, fail) => {
            const heads = tx.objectStore('queue-state');
            const request = heads.get('active');
            request.onsuccess = () => {
              try {
                const store = tx.objectStore('queue-documents');
                for (const doc of documents) {
                  if (!sameDocument(oldDocs.get(doc.localId), doc)) {
                    // Blob URLs belong to the old page; rebuild them after a refresh.
                    store.put(
                      { ...doc, pages: doc.pages.map((page) => ({ ...page, imageUrl: null })) },
                      doc.localId,
                    );
                  }
                }
                for (const id of (request.result?.ids ?? []) as string[])
                  if (!head.ids.includes(id)) store.delete(id);
                heads.put(head, 'active');
              } catch (error) {
                fail(
                  error instanceof Error || error instanceof DOMException
                    ? error
                    : new Error(String(error)),
                );
              }
            };
          },
        );
        this.stored = snapshot;
        // Small progress checkpoint only. Files and page text stay in IndexedDB.
        const { rememberedDetails: _privateDetails, ...progress } = head;
        localStorage.setItem(
          QUEUE_PROGRESS_KEY,
          JSON.stringify({
            ...progress,
            documents: documents.map(({ localId, fileName, status }) => ({
              localId,
              fileName,
              status,
            })),
          }),
        );
      }
      this.status.set('saved');
    } catch (error) {
      this.failed(error);
      throw error;
    } finally {
      this.writing = undefined;
    }
  }

  failed(error: unknown) {
    this.status.set('error');
    this.error.set(
      error instanceof DOMException && error.name === 'QuotaExceededError'
        ? 'Device storage is full. Keep this tab open, free some space and retry saving progress.'
        : error instanceof Error
          ? error.message
          : 'Progress could not be saved on this device. Keep this tab open and retry.',
    );
  }
}

function validRememberedDetails(value: unknown): boolean {
  if (value === undefined) return true; // Older checkpoints did not remember details.
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (details) =>
        Array.isArray(details) &&
        details.every(
          (detail) =>
            detail &&
            typeof detail.key === 'string' &&
            detail.key.length > 0 &&
            detail.key.length <= 200 &&
            [
              'person',
              'address',
              'national-id',
              'id-number',
              'contact',
              'birth-date',
              'age',
              'other',
            ].includes(detail.kind),
        ),
    )
  );
}

import { Injectable, signal } from '@angular/core';
import { LocalHistory } from './local-history';
import type { RecordsResponse } from './records';
import type { RecoveryResponse, RecoveryStartRequest, RecoveryAcceptRequest, RecoveryRejectRequest } from './recovery';
import { PROCESSING_VERSION, type PageTranscription } from '../../../api/src/demo/processing-contract';

const LIMITS = { maxWordsPerPage: 800, maxCharactersPerPage: 24000, maxProposalsPerCall: 250, maxCallsPerDocument: 12, maxAttemptsPerPage: 2 };

/** Approved sources stay in this browser; results require successful server processing. */
@Injectable({ providedIn: 'root' })
export class DocumentsApi extends LocalHistory {
  private check: { fingerprint: string; promise: Promise<RecordsResponse> } | null = null;
  private readonly recovering = new Set<string>();

  readonly processing = signal({ stage: 'idle', completed: 0, total: 0, error: null as string | null });
  private transcribing: Promise<void> | null = null;
  private batchId: string = crypto.randomUUID();
  private batchReady = true;
  private readonly failedPages = new Set<string>();

  prepareBatch(batchId: string, ready: boolean) {
    this.batchId = batchId; this.batchReady = ready;
    if (ready) void this.records().catch(() => {});
    else void this.transcribe().catch(() => {});
  }

  private transcribe(retry = false): Promise<void> {
    if (retry) this.failedPages.clear();
    if (this.transcribing) return this.transcribing;
    const work = async () => {
      const active = new Set<string>();
      const key = (source: { pageId: string; revision: string }) => `${source.pageId}/${source.revision}`;
      let total = (await this.list()).reduce((n, d) => n + d.pageCount, 0);
      let firstError: unknown;
      await Promise.all(Array.from({ length: 3 }, async () => {
        for (;;) {
          const snapshot = this.recordSnapshot();
          const source = snapshot.sources.find(s => !active.has(key(s)) && !this.failedPages.has(key(s)));
          if (!source) return;
          active.add(key(source));
          total = (await this.list()).reduce((n, d) => n + d.pageCount, 0);
          const current = () => this.pageSourceCurrent(source.documentId, source.revision, source.page);
          this.processing.set({ stage: 'transcribing', total, completed: total - snapshot.sources.length, error: null });
          const started = performance.now();
          try {
            const blob = await this.pageImage(source.documentId, source.page);
            // Only persisted, approved images are eligible. No manifests, filenames or OCR words leave here.
            const image = await imageDataUrl(blob);
            if (!current()) continue;
            const result = await post<PageTranscription>('/api/demo/extract', { ...source, batchId: source.batchId ?? this.batchId, image }, 180000, current);
            this.savePageProcessing(source.documentId, source.revision, result);
            console.info('[Carryover timing]', { stage: 'upload-spark', batchId: source.batchId ?? this.batchId, pageId: source.pageId,
              elapsedMs: Math.round(performance.now() - started), rows: result.observations.length });
          } catch (error) {
            if (!current()) continue;
            this.failedPages.add(key(source)); firstError ??= error;
          } finally { active.delete(key(source)); }
        }
      }));
      const remaining = this.recordSnapshot().sources.length;
      if (firstError || remaining) {
        const error = firstError instanceof Error ? firstError.message : 'Some pages still need transcription. Retry or remove the document.';
        this.processing.set({ stage: 'error', total, completed: total - remaining, error });
        throw new Error(error);
      }
      this.processing.set({ stage: this.batchReady ? 'transcribing' : 'waiting', total, completed: total, error: null });
    };
    this.transcribing = work().finally(() => { this.transcribing = null; });
    return this.transcribing;
  }

  override async records(retry = false): Promise<RecordsResponse> {
    const snapshot = this.recordSnapshot();
    if (!snapshot.documents.length) {
      this.check = null;
      this.processing.set({ stage: 'idle', completed: 0, total: 0, error: null });
      return { domains: [], textResults: [], warnings: [], issues: [],
        stats: { documents: 0, tests: 0, values: 0, from: null, to: null },
        model: { state: 'ready', name: null, waiting: 0, message: null } };
    }
    if (this.check?.fingerprint === snapshot.fingerprint) return this.check.promise;
    const cached = this.cachedModelRecords();
    if (cached?.model.state === 'ready' && !retry && this.batchReady && !snapshot.sources.length) {
      this.processing.update(p => ({ ...p, stage: 'ready', error: null }));
      return { ...cached, issues: snapshot.issues };
    }
    const promise: Promise<RecordsResponse> = (async () => {
      await this.transcribe(retry);
      if (!this.batchReady) throw new Error('Finish preparing and approving or removing the remaining documents before normalization.');
      const processed = this.recordSnapshot();
      if (processed.sources.length) throw new Error('Some pages still need transcription. Please retry.');
      const started = performance.now();
      this.processing.update(p => ({ ...p, stage: 'normalizing', error: null }));
      const batchId = this.batchId;
      const current = () => this.batchReady && this.batchId === batchId && this.recordSnapshot().fingerprint === processed.fingerprint;
      const result = await post<RecordsResponse>('/api/demo/records', { processingVersion: PROCESSING_VERSION, batchId, documents: processed.documents }, 180000, current);
      if (result.model?.state !== 'ready') throw new Error('Results normalization did not finish. Please try again.');
      if (!current()) throw new Error('The batch changed. Finish reviewing it and try again.');
      const records = { ...result, issues: processed.issues };
      if (!this.saveModelRecords(processed.fingerprint, records)) throw new Error('The batch changed. Please try again.');
      console.info('[Carryover timing]', { stage: 'wonder-normalization', batchId: this.batchId, elapsedMs: Math.round(performance.now() - started), documents: processed.documents.length });
      this.processing.update(p => ({ ...p, stage: 'ready', error: null }));
      return records;
    })().catch(error => {
      if (this.check?.promise === promise) this.processing.update(p => ({ ...p, stage: 'error', error: error.message }));
      throw error;
    }).finally(() => { if (this.check?.promise === promise) this.check = null; });
    this.check = { fingerprint: snapshot.fingerprint, promise };
    return promise;
  }

  retryRecords() { return this.records(true); }

  async recovery(id: string): Promise<RecoveryResponse> {
    const snapshot = this.recoverySnapshot(id);
    const state = snapshot.recovery ?? { documentId: id, sourceRevision: snapshot.revision, status: 'idle', modelName: 'muse-spark-1.3',
      activePage: null, message: null, proposals: [], updatedAt: null, attempts: {}, limits: LIMITS } satisfies RecoveryResponse;
    if (state.sourceRevision !== snapshot.revision) return { ...state, sourceRevision: snapshot.revision, status: 'idle', proposals: [], message: 'The source changed. Check the current page.' };
    if (state.status === 'working' && !this.recovering.has(id)) return { ...state, status: 'error', message: 'The page check was interrupted. Try again.' };
    return state;
  }

  async findMissedReadings(id: string, request: RecoveryStartRequest): Promise<RecoveryResponse> {
    const snapshot = this.recoverySnapshot(id), state = await this.recovery(id);
    if (request.expectedRevision !== snapshot.revision || this.recovering.has(id)) throw new Error('The document changed or a check is already running. Reopen it.');
    if (!snapshot.document.pages[request.page]?.hasImage) throw new Error('Reopen this source and save a redacted page image first.');
    if ((state.attempts[request.page] ?? 0) >= LIMITS.maxAttemptsPerPage || Object.values(state.attempts).reduce((a, b) => a + b, 0) >= LIMITS.maxCallsPerDocument) throw new Error('This source has reached its automatic check limit. Review the existing suggestions.');
    const working: RecoveryResponse = { ...state, sourceRevision: snapshot.revision, status: 'working', activePage: request.page,
      message: 'Spark is checking the approved page image.', attempts: { ...state.attempts, [request.page]: (state.attempts[request.page] ?? 0) + 1 }, updatedAt: new Date().toISOString() };
    this.saveRecovery(id, snapshot.revision, working); this.recovering.add(id);
    const current = () => { try { return this.recoverySnapshot(id).revision === snapshot.revision; } catch { return false; } };
    void (async () => {
      const image = await imageDataUrl(await this.pageImage(id, request.page));
      const result = await post<PageTranscription>('/api/demo/extract', { batchId: this.batchId, documentId: id, pageId: `${id}:${request.page}`, page: request.page, revision: snapshot.revision, image }, 180000, current);
      if (!current()) return;
      const same = (a: typeof snapshot.observations[number], b: typeof snapshot.observations[number]) => a.page === b.page && a.name === b.name && a.valueText === b.valueText && a.unit === b.unit && a.date === b.date
        && a.transcription?.specimen === b.transcription?.specimen && a.transcription?.method === b.transcription?.method;
      const added = result.observations.filter(o => !snapshot.observations.some(old => same(old, o)) && !working.proposals.some(p => p.sourceObservation && same(p.sourceObservation, o))).map(o => ({
        id: crypto.randomUUID(), page: o.page, name: o.name, valueText: o.valueText, unit: o.unit, date: o.date,
        dateText: o.transcription?.collectionDate.printed ?? null, refText: o.refText, bbox: o.bbox, words: [],
        evidence: { name: [], value: [], unit: [], date: [], reference: [] }, sourceObservation: o,
        issues: o.transcription?.uncertainty ?? [], state: 'pending' as const, revision: crypto.randomUUID(), decidedAt: null, note: null,
      }));
      this.saveRecovery(id, snapshot.revision, { ...working, status: 'ready', proposals: [...working.proposals, ...added], message: added.length ? 'Check each proposed reading against its source before accepting it.' : 'No additional readings found.' });
    })().catch(() => { try { this.saveRecovery(id, snapshot.revision, { ...working, status: 'error', message: 'The page check did not finish. Please try again.' }); } catch { /* Preserve prior data on quota errors. */ } })
      .finally(() => this.recovering.delete(id));
    return working;
  }

  async acceptRecoveredReading(id: string, proposal: string, request: RecoveryAcceptRequest) {
    return this.decideRecovery(id, proposal, request.expectedRevision, 'accepted', request.note);
  }
  async rejectRecoveredReading(id: string, proposal: string, request: RecoveryRejectRequest) {
    return this.decideRecovery(id, proposal, request.expectedRevision, 'rejected');
  }

}

async function post<T>(url: string, body: unknown, timeout: number, current = () => true): Promise<T> {
  let response: Response;
  for (let attempt = 0; ; attempt++) {
    if (!current()) throw new Error('The source changed.');
    try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
    catch { throw new Error('We couldn’t finish processing. Please try again.'); }
    if (response.status !== 429 || attempt >= 4) break;
    // Respect server capacity/rate limits; an otherwise healthy large import
    // should wait briefly instead of making the user restart it.
    const seconds = Number(response.headers.get('Retry-After'));
    const delay = seconds > 0 && Number.isFinite(seconds) ? Math.min(seconds * 1000, 60000) : 1000 * 2 ** attempt;
    await response.body?.cancel();
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.message === 'string' ? error.message : 'The Meta AI check failed. Try again shortly.');
  }
  return await response.json() as T;
}

function imageDataUrl(blob: Blob): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(blob.type)) throw new Error('This saved source needs a redacted page image. Open it for review.');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The saved page could not be read.'));
    reader.readAsDataURL(blob);
  });
}

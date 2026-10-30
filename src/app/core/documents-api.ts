import { Injectable } from '@angular/core';
import { LocalHistory } from './local-history';
import type { RecordsResponse } from './records';
import type { RecoveryResponse, RecoveryStartRequest, RecoveryAcceptRequest, RecoveryRejectRequest } from './recovery';

const LIMITS = { maxWordsPerPage: 800, maxCharactersPerPage: 24000, maxProposalsPerCall: 24, maxCallsPerDocument: 12, maxAttemptsPerPage: 2 };

/** Approved sources stay in this browser; results require successful server processing. */
@Injectable({ providedIn: 'root' })
export class DocumentsApi extends LocalHistory {
  private check: { fingerprint: string; promise: Promise<RecordsResponse> } | null = null;
  private readonly recovering = new Set<string>();

  override async records(retry = false): Promise<RecordsResponse> {
    const snapshot = this.recordSnapshot();
    if (!snapshot.documents.length) {
      this.check = null;
      return { domains: [], textResults: [], warnings: [], issues: [],
        stats: { documents: 0, tests: 0, values: 0, from: null, to: null },
        model: { state: 'ready', name: null, waiting: 0, message: null } };
    }
    if (this.check?.fingerprint === snapshot.fingerprint && !retry) return this.check.promise;
    const cached = this.cachedModelRecords();
    if (cached?.model.state === 'ready' && !retry) return { ...cached, issues: snapshot.issues };
    const promise: Promise<RecordsResponse> = post<RecordsResponse>('/api/demo/records', { documents: snapshot.documents }, 180000)
      .then((result) => {
        if (result.model?.state !== 'ready') throw new Error('Results processing did not finish. Please try again.');
        // A deletion or correction during processing invalidates the old response.
        if (this.recordSnapshot().fingerprint !== snapshot.fingerprint) return this.records();
        const records = { ...result, issues: snapshot.issues };
        this.saveModelRecords(snapshot.fingerprint, records);
        return records;
      })
      .catch((error) => {
        if (this.check?.promise === promise) this.check = null;
        throw error;
      });
    this.check = { fingerprint: snapshot.fingerprint, promise };
    return promise;
  }

  retryRecords() { return this.records(true); }

  async recovery(id: string): Promise<RecoveryResponse> {
    const snapshot = this.recoverySnapshot(id);
    const state = snapshot.recovery ?? { documentId: id, sourceRevision: snapshot.revision, status: 'idle', modelName: 'Meta AI',
      activePage: null, message: null, proposals: [], updatedAt: null, attempts: {}, limits: LIMITS } satisfies RecoveryResponse;
    if (state.status === 'working' && !this.recovering.has(id)) {
      state.status = 'error'; state.message = 'This check was interrupted. Start it again when ready.';
    }
    if (state.status === 'unavailable') return { ...state, status: 'idle', message: null };
    return state;
  }

  async findMissedReadings(id: string, request: RecoveryStartRequest): Promise<RecoveryResponse> {
    const snapshot = this.recoverySnapshot(id);
    const state = await this.recovery(id);
    if (request.expectedRevision !== state.sourceRevision || this.recovering.has(id)) throw new Error('The source changed or a check is already running. Reopen it and try again.');
    if (!snapshot.document.pages[request.page]) throw new Error('Choose a valid source page.');
    if ((state.attempts[String(request.page)] ?? 0) >= LIMITS.maxAttemptsPerPage || Object.values(state.attempts).reduce((a, b) => a + b, 0) >= LIMITS.maxCallsPerDocument) throw new Error('This source has reached its automatic check limit. Review the existing suggestions.');
    const working: RecoveryResponse = { ...state, status: 'working', activePage: request.page, message: 'Meta AI is checking the approved source text.',
      updatedAt: new Date().toISOString(), attempts: { ...state.attempts, [request.page]: (state.attempts[String(request.page)] ?? 0) + 1 } };
    if (!this.saveRecovery(id, snapshot.revision, working)) throw new Error('The document changed. Reopen it.');
    this.recovering.add(id);
    void post<Pick<RecoveryResponse, 'sourceRevision' | 'proposals' | 'modelName' | 'limits'>>('/api/demo/recovery', {
      document: snapshot.document, page: request.page,
      acceptedEvidence: snapshot.observations.filter((o) => o.recovery).map((o) => ({ page: o.page, evidence: o.recovery!.evidence })),
    }, 70000).then((answer) => {
      const existing = new Set(working.proposals.map((proposal) => proposal.id));
      const added = answer.proposals.filter((proposal) => !existing.has(proposal.id));
      this.saveRecovery(id, snapshot.revision, { ...working, ...answer, status: 'ready', proposals: [...working.proposals, ...added], updatedAt: new Date().toISOString(),
        message: added.length ? `${added.length} proposed readings are ready to check. Nothing is added until you confirm.` : 'No additional readings could be verified on this page.' });
    }).catch((error) => {
      try { this.saveRecovery(id, snapshot.revision, { ...working, status: 'error', message: error.message }); } catch { /* Keep the previous history intact if storage is full. */ }
    }).finally(() => this.recovering.delete(id));
    return working;
  }

  async acceptRecoveredReading(id: string, proposal: string, request: RecoveryAcceptRequest) {
    return this.decideRecovery(id, proposal, request.expectedRevision, 'accepted', request.note);
  }
  async rejectRecoveredReading(id: string, proposal: string, request: RecoveryRejectRequest) {
    return this.decideRecovery(id, proposal, request.expectedRevision, 'rejected');
  }

}

async function post<T>(url: string, body: unknown, timeout: number): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error('We couldn’t finish processing. Please try again.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.message === 'string' ? error.message : 'The Meta AI check failed. Try again shortly.');
  }
  return await response.json() as T;
}

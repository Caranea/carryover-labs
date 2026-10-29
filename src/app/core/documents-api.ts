import { Injectable } from '@angular/core';
import { LocalHistory } from './local-history';
import type { RecordsResponse } from './records';
import type { RecoveryResponse, RecoveryStartRequest, RecoveryAcceptRequest, RecoveryRejectRequest } from './recovery';

const LIMITS = { maxWordsPerPage: 800, maxCharactersPerPage: 24000, maxProposalsPerCall: 24, maxCallsPerDocument: 12, maxAttemptsPerPage: 2 };

/** History is local; only stateless Meta AI checks use the server. */
@Injectable({ providedIn: 'root' })
export class DocumentsApi extends LocalHistory {
  private configuration: Promise<{ modelName: string | null }> | null = null;
  private check: { fingerprint: string; result: RecordsResponse | null } | null = null;
  private readonly recovering = new Set<string>();
  private retry = false;

  override async records(): Promise<RecordsResponse> {
    const local = await super.records();
    const snapshot = this.recordSnapshot();
    if (!snapshot.documents.length) return local;
    if (this.check?.fingerprint === snapshot.fingerprint && !this.retry) {
      return this.check.result ?? { ...local, model: { state: 'working', name: null, waiting: 1, message: null } };
    }
    const cached = this.cachedModelRecords();
    if (cached && !this.retry) return { ...cached, issues: local.issues };
    this.retry = false;
    let config;
    try { config = await this.config(); }
    catch { return { ...local, model: { state: 'error', name: 'Meta AI', waiting: 0, message: 'Meta AI is unavailable. Start the demo API, then retry matching. Your local results are available.' } }; }
    if (!config.modelName) return { ...local, model: { state: 'off', name: null, waiting: 0, message: 'Add the Meta or Baseten API key to enable AI checks. Your local results are available.' } };
    // Another view may have started this same check while configuration was loading.
    if (this.check?.fingerprint === snapshot.fingerprint && this.check.result === null) {
      return { ...local, model: { state: 'working', name: config.modelName, waiting: 1, message: null } };
    }
    if (this.recordSnapshot().fingerprint !== snapshot.fingerprint) return this.records();
    const job = this.check = { fingerprint: snapshot.fingerprint, result: null as RecordsResponse | null };
    void post<RecordsResponse>('/api/demo/records', { documents: snapshot.documents }, 180000)
      .then((result) => { job.result = { ...result, issues: local.issues }; this.saveModelRecords(snapshot.fingerprint, job.result); })
      .catch((error) => { job.result = { ...local, model: { state: 'error', name: config.modelName, waiting: 0, message: error.message } }; });
    return { ...local, model: { state: 'working', name: config.modelName, waiting: 1, message: null } };
  }

  retryRecords() { this.retry = true; this.configuration = null; return this.records(); }

  async recovery(id: string): Promise<RecoveryResponse> {
    const snapshot = this.recoverySnapshot(id);
    let modelName: string | null = null;
    try { modelName = (await this.config()).modelName; } catch { /* Saved proposals can still be reviewed offline. */ }
    const state = snapshot.recovery ?? { documentId: id, sourceRevision: snapshot.revision, status: 'idle', modelName,
      activePage: null, message: null, proposals: [], updatedAt: null, attempts: {}, limits: LIMITS } satisfies RecoveryResponse;
    if (state.status === 'working' && !this.recovering.has(id)) {
      state.status = 'error'; state.message = 'This check was interrupted. Start it again when ready.';
    }
    if (!modelName && state.status !== 'working') return { ...state, status: 'unavailable', message: 'Meta AI is unavailable. Start the API and configure its Meta or Baseten key to find missed readings.' };
    return state;
  }

  async findMissedReadings(id: string, request: RecoveryStartRequest): Promise<RecoveryResponse> {
    const snapshot = this.recoverySnapshot(id);
    const state = await this.recovery(id);
    if (request.expectedRevision !== state.sourceRevision || this.recovering.has(id)) throw new Error('The source changed or a check is already running. Reopen it and try again.');
    if (!snapshot.document.pages[request.page] || state.status === 'unavailable') throw new Error('Choose an available source page and start the demo API.');
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

  private config() {
    this.configuration ??= fetch('/api/demo/config', { signal: AbortSignal.timeout(5000) }).then(async (response) => {
      if (!response.ok) throw new Error('Demo API unavailable');
      return await response.json() as { modelName: string | null };
    }).catch((error) => { this.configuration = null; throw error; });
    return this.configuration;
  }
}

async function post<T>(url: string, body: unknown, timeout: number): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) }); }
  catch { throw new Error('The Meta AI request could not finish. Your saved results are unchanged; try again when the API is available.'); }
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(typeof error.message === 'string' ? error.message : 'The Meta AI check failed. Try again shortly.');
  }
  return await response.json() as T;
}

import { BadRequestException, ConflictException, HttpException, HttpStatus, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SavedDocument } from '../documents/contract.js';
import { DocumentStorage, NotFoundError } from '../documents/storage.js';
import { extractDocument } from '../results/extract.js';
import type { Observation } from '../results/contract.js';
import { validateAnswer, type JsonModel, type ModelTask } from '../records/muse.js';
import type { RecoveryLedger, RecoveryResponse, StoredRecoveryProposal } from './contract.js';
import { RECOVERY_LIMITS, recoveryTask, type RecoveryAnswer } from './prompt.js';
import { acceptedRecoveryObservations, presentProposal, recoveryProposalId, recoveryProposalRevision, recoverySourceRevision, verifyEvidence } from './verify.js';

const MAX_ACTIVE_JOBS = 4;
const MAX_PROPOSALS_PER_DOCUMENT = 120;
const TIMEOUT_MS = 65_000;
interface ActiveJob { id: string; documentId: string }

/** Explicit, bounded inference. GET reads state; it never starts or retries an external call. */
export class RecoveryService {
  private readonly log = new Logger('Recovery');
  private readonly active = new Map<string, ActiveJob>();

  constructor(private readonly storage: DocumentStorage, private readonly model: JsonModel | null, private readonly timeoutMs = TIMEOUT_MS) {}

  async status(userId: string, documentId: string): Promise<RecoveryResponse> {
    return this.withDocument(userId, documentId, async (doc) => this.response(userId, doc, await this.ledger(userId, doc)));
  }

  async start(userId: string, documentId: string, body: unknown): Promise<RecoveryResponse> {
    const input = objectBody(body, ['page', 'expectedRevision']);
    const expectedRevision = revision(input.expectedRevision);
    if (!Number.isInteger(input.page) || (input.page as number) < 0) throw new BadRequestException('Choose a valid page to check.');
    const page = input.page as number;
    const launch: { value?: { doc: SavedDocument; task: ModelTask; id: string } } = {};
    const response = await this.withDocument(userId, documentId, async (doc) => {
      const sourceRevision = recoverySourceRevision(doc);
      if (expectedRevision !== sourceRevision) throw new ConflictException('The source changed. Reload this document before checking it.');
      if (!doc.pages[page]) throw new BadRequestException('This page is not in the document.');
      const current = await this.ledger(userId, doc);
      if (!this.model) return this.response(userId, doc, current);
      if (this.active.has(userId)) throw new ConflictException('A source check is already running. Wait for it to finish before starting another.');
      if (this.active.size >= MAX_ACTIVE_JOBS) throw new HttpException('Automatic source checks are busy. Try again shortly.', HttpStatus.TOO_MANY_REQUESTS);
      const ledger: RecoveryLedger = current ?? { version: 1, sourceRevision, attempts: {}, proposals: [], job: null, updatedAt: new Date().toISOString() };
      if ((ledger.attempts[String(page)] ?? 0) >= RECOVERY_LIMITS.maxAttemptsPerPage) throw new BadRequestException('This page has reached its automatic check limit. You can still review and correct its saved readings.');
      if (Object.values(ledger.attempts).reduce((sum, n) => sum + n, 0) >= RECOVERY_LIMITS.maxCallsPerDocument) throw new BadRequestException('This document has reached its automatic check limit. Review the proposed readings before continuing manually.');
      if (ledger.proposals.length >= MAX_PROPOSALS_PER_DOCUMENT) throw new BadRequestException('This document has reached its recovery suggestion limit.');
      const original = extractDocument(doc).observations;
      const existing = [...original, ...acceptedRecoveryObservations(doc, ledger, original)];
      let task: ModelTask;
      try { task = recoveryTask(doc, page, existing); }
      catch (error) { throw new BadRequestException((error as Error).message); }
      const id = randomUUID(), now = new Date().toISOString();
      ledger.attempts[String(page)] = (ledger.attempts[String(page)] ?? 0) + 1;
      ledger.job = { id, page, state: 'working', message: 'Checking this page for missed readings. New suggestions will need your confirmation.', startedAt: now, finishedAt: null };
      ledger.updatedAt = now;
      // Reserve synchronously before I/O so starts for different accounts cannot exceed the global cap.
      this.active.set(userId, { id, documentId });
      try {
        await this.storage.writeExtra(userId, documentId, 'recovery', ledger);
        const response = this.response(userId, doc, ledger);
        launch.value = { doc, task, id };
        return response;
      } catch (error) {
        if (this.active.get(userId)?.id === id) this.active.delete(userId);
        throw error;
      }
    });
    // Dispatch after leaving the storage lock, so a slow provider never blocks redaction/deletion.
    if (launch.value) void this.run(userId, launch.value.doc, launch.value.id, launch.value.task);
    return response;
  }

  async decide(userId: string, documentId: string, proposalId: string, decision: 'accepted' | 'rejected', body: unknown): Promise<RecoveryResponse> {
    const input = objectBody(body, decision === 'accepted' ? ['expectedRevision', 'note'] : ['expectedRevision']);
    const expectedRevision = revision(input.expectedRevision);
    const note = decision === 'accepted' ? confirmationNote(input.note) : '';
    return this.withDocument(userId, documentId, async (doc) => {
      const ledger = await this.ledger(userId, doc);
      const proposal = ledger?.proposals.find((p) => p.id === proposalId);
      if (!ledger || !proposal) throw new NotFoundException('This suggestion is no longer available.');
      if (recoveryProposalRevision(ledger.sourceRevision, proposal) !== expectedRevision || proposal.state !== 'pending') throw new ConflictException('This suggestion changed or has already been reviewed. Reload it before continuing.');
      if (proposal.id !== recoveryProposalId(ledger.sourceRevision, proposal.page, proposal.evidence)) throw new ConflictException('This suggestion no longer matches its source evidence.');
      if (decision === 'accepted') {
        const original = extractDocument(doc).observations;
        const verified = verifyEvidence(doc, proposal.page, proposal.evidence, [...original, ...acceptedRecoveryObservations(doc, ledger, original)]);
        if (!verified.ok) throw new ConflictException('This suggestion can no longer be verified against the source. Reload the document.');
      }
      const now = new Date().toISOString();
      proposal.state = decision;
      proposal.decision = { at: now, note };
      ledger.updatedAt = now;
      await this.storage.writeExtra(userId, documentId, 'recovery', ledger);
      return this.response(userId, doc, ledger);
    });
  }

  private async run(userId: string, snapshot: SavedDocument, jobId: string, task: ModelTask): Promise<void> {
    const documentId = snapshot.id, sourceRevision = recoverySourceRevision(snapshot);
    try {
      // Refuse dispatch if the user changed or deleted the source while the request was queued.
      await this.withDocument(userId, documentId, async (doc) => {
        if (recoverySourceRevision(doc) !== sourceRevision) throw new Error('Source changed');
      });
      const answer = validateAnswer<RecoveryAnswer>(task, await bounded(this.model!.ask<unknown>(task), this.timeoutMs));
      await this.withDocument(userId, documentId, async (doc) => {
        const ledger = await this.ledger(userId, doc);
        if (!ledger || ledger.sourceRevision !== sourceRevision || ledger.job?.id !== jobId) return;
        const original = extractDocument(doc).observations;
        const occupied: Observation[] = [...original];
        for (const proposal of ledger.proposals) {
          const verified = verifyEvidence(doc, proposal.page, proposal.evidence, original);
          if (verified.ok) occupied.push(verified.observation);
        }
        let added = 0, discarded = 0;
        for (const row of answer.rows) {
          const { page, ...evidence } = row;
          const verified = verifyEvidence(doc, page, evidence, occupied);
          if (!verified.ok || ledger.proposals.length >= MAX_PROPOSALS_PER_DOCUMENT) { discarded++; continue; }
          const id = recoveryProposalId(sourceRevision, page, evidence);
          if (ledger.proposals.some((p) => p.id === id)) { discarded++; continue; }
          const proposal: StoredRecoveryProposal = { id, page, evidence, state: 'pending', model: this.model!.name, createdAt: new Date().toISOString(), decision: null };
          ledger.proposals.push(proposal);
          occupied.push(verified.observation);
          added++;
        }
        const now = new Date().toISOString();
        ledger.job.state = 'ready';
        ledger.job.finishedAt = now;
        ledger.job.message = added
          ? `${added} ${added === 1 ? 'reading is' : 'readings are'} ready for you to compare with the source. Nothing is added until you confirm.${discarded ? ' Some suggestions could not be verified and were discarded.' : ''}`
          : 'No additional readings could be verified on this page. Your saved readings are unchanged.';
        ledger.updatedAt = now;
        await this.storage.writeExtra(userId, documentId, 'recovery', ledger);
      });
    } catch {
      this.log.warn('An explicitly requested source recovery check could not finish.');
      try {
        await this.withDocument(userId, documentId, async (doc) => {
          const ledger = await this.ledger(userId, doc);
          if (!ledger || ledger.sourceRevision !== sourceRevision || ledger.job?.id !== jobId) return;
          ledger.job.state = 'error';
          ledger.job.message = 'The source check could not finish. Your saved readings are unchanged. You may explicitly try this page again.';
          ledger.job.finishedAt = new Date().toISOString();
          ledger.updatedAt = ledger.job.finishedAt;
          await this.storage.writeExtra(userId, documentId, 'recovery', ledger);
        });
      } catch { /* A deleted or changed source must not be recreated by a delayed job. */ }
    } finally {
      if (this.active.get(userId)?.id === jobId) this.active.delete(userId);
    }
  }

  private async ledger(userId: string, doc: SavedDocument): Promise<RecoveryLedger | null> {
    const saved = await this.storage.readExtra<RecoveryLedger>(userId, doc.id, 'recovery');
    return saved?.version === 1 && saved.sourceRevision === recoverySourceRevision(doc) ? saved : null;
  }

  private response(userId: string, doc: SavedDocument, ledger: RecoveryLedger | null): RecoveryResponse {
    const original = extractDocument(doc).observations;
    const sourceRevision = recoverySourceRevision(doc);
    const interrupted = ledger?.job?.state === 'working' && this.active.get(userId)?.id !== ledger.job.id;
    return {
      documentId: doc.id, sourceRevision,
      status: !this.model ? 'unavailable' : interrupted ? 'error' : ledger?.job?.state ?? 'idle',
      modelName: this.model?.name ?? null, activePage: ledger?.job?.page ?? null,
      message: !this.model ? 'Automatic source checks are unavailable because no model is configured. You can still review and correct saved readings.'
        : interrupted ? 'This check was interrupted. Start it again when you are ready.' : ledger?.job?.message ?? null,
      proposals: (ledger?.proposals ?? []).map((p) => presentProposal(doc, p, original, sourceRevision)).filter((p) => p !== null),
      updatedAt: ledger?.updatedAt ?? null, attempts: ledger?.attempts ?? {}, limits: RECOVERY_LIMITS,
    };
  }

  private async withDocument<T>(userId: string, documentId: string, work: (doc: SavedDocument) => Promise<T>): Promise<T> {
    try { return await this.storage.withDocumentLock(userId, documentId, async () => work(await this.storage.read(userId, documentId))); }
    catch (error) { if (error instanceof NotFoundError) throw new NotFoundException('This document is no longer available.'); throw error; }
  }
}

function objectBody(body: unknown, fields: string[]): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key))) throw new BadRequestException('The source-check request contains unsupported fields.');
  return body as Record<string, unknown>;
}
function revision(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new BadRequestException('Reload the source before continuing.');
  return value;
}
function confirmationNote(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(value)) throw new BadRequestException('Write a short note about what you checked, up to 500 characters.');
  return value.trim();
}
async function bounded<T>(work: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Source check timed out')), milliseconds); })]); }
  finally { if (timer) clearTimeout(timer); }
}

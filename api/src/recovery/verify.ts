import { createHash } from 'node:crypto';
import type { SavedDocument } from '../documents/contract.js';
import type { Observation } from '../results/contract.js';
import type { RecoveryEvidence, RecoveryLedger, RecoveryProposal, StoredRecoveryProposal } from './contract.js';
import { verifyEvidence } from './verify-core.js';
export { verifyEvidence, visibleWord } from './verify-core.js';
export type { VerificationFailure, VerifiedEvidence } from './verify-core.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function recoverySourceRevision(doc: SavedDocument): string {
  return digest({ id: doc.id, updatedAt: doc.updatedAt, pages: doc.pages });
}

export function recoveryProposalId(sourceRevision: string, page: number, evidence: RecoveryEvidence): string {
  return 'r-' + digest([sourceRevision, page, evidence]).slice(0, 24);
}

export function recoveryProposalRevision(sourceRevision: string, proposal: StoredRecoveryProposal): string {
  return digest([sourceRevision, proposal]);
}

export function presentProposal(doc: SavedDocument, stored: StoredRecoveryProposal, existing: Observation[], sourceRevision = recoverySourceRevision(doc)): RecoveryProposal | null {
  if (stored.id !== recoveryProposalId(sourceRevision, stored.page, stored.evidence)) return null;
  const verified = verifyEvidence(doc, stored.page, stored.evidence, existing);
  if (!verified.ok) return null;
  const o = verified.observation;
  return {
    id: stored.id, page: stored.page, name: o.name, valueText: o.valueText, unit: o.unit, date: o.date,
    dateText: verified.dateText, refText: o.refText, words: o.words, bbox: o.bbox, evidence: stored.evidence,
    issues: verified.issues, state: stored.state, revision: recoveryProposalRevision(sourceRevision, stored),
    decidedAt: stored.decision?.at ?? null, note: stored.decision?.note ?? null,
  };
}

/** Only an accepted, unchanged and still-verifiable proposal becomes a source observation. */
export function acceptedRecoveryObservations(doc: SavedDocument, ledger: RecoveryLedger | null, deterministic: Observation[]): Observation[] {
  const sourceRevision = recoverySourceRevision(doc);
  if (ledger?.version !== 1 || ledger.sourceRevision !== sourceRevision) return [];
  const accepted: Observation[] = [];
  for (const proposal of ledger.proposals) {
    if (proposal.state !== 'accepted' || !proposal.decision?.note) continue;
    const verified = verifyEvidence(doc, proposal.page, proposal.evidence, [...deterministic, ...accepted]);
    if (!verified.ok || proposal.id !== recoveryProposalId(sourceRevision, proposal.page, proposal.evidence)) continue;
    accepted.push({
      ...verified.observation,
      id: `${doc.id}:recovery:${proposal.id}`,
      confirmed: true,
      recovery: { proposalId: proposal.id, sourceRevision, model: proposal.model, acceptedAt: proposal.decision.at, note: proposal.decision.note, evidence: proposal.evidence },
    });
  }
  return accepted;
}

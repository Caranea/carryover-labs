import type { Tuple4 } from '../documents/contract.js';

/** Every field is a list of original, zero-based page word indices. No generated text. */
export interface RecoveryEvidence {
  name: number[];
  value: number[];
  unit: number[];
  date: number[];
  reference: number[];
}

export interface RecoveryProposal {
  id: string;
  page: number;
  name: string;
  valueText: string;
  unit: string | null;
  date: string | null;
  dateText: string | null;
  refText: string | null;
  words: number[];
  bbox: Tuple4 | null;
  evidence: RecoveryEvidence;
  issues: string[];
  state: 'pending' | 'accepted' | 'rejected';
  revision: string;
  decidedAt: string | null;
  note: string | null;
}

export interface RecoveryLimits {
  maxWordsPerPage: number;
  maxCharactersPerPage: number;
  maxProposalsPerCall: number;
  maxCallsPerDocument: number;
  maxAttemptsPerPage: number;
}

export interface RecoveryResponse {
  documentId: string;
  sourceRevision: string;
  status: 'idle' | 'working' | 'ready' | 'error' | 'unavailable';
  modelName: string | null;
  activePage: number | null;
  message: string | null;
  proposals: RecoveryProposal[];
  updatedAt: string | null;
  attempts: Record<string, number>;
  limits: RecoveryLimits;
}

export interface RecoveryStartRequest {
  page: number;
  expectedRevision: string;
}

export interface RecoveryAcceptRequest {
  expectedRevision: string;
  note: string;
}

export interface RecoveryRejectRequest {
  expectedRevision: string;
}

export interface StoredRecoveryProposal {
  id: string;
  page: number;
  evidence: RecoveryEvidence;
  state: 'pending' | 'accepted' | 'rejected';
  model: string;
  createdAt: string;
  decision: { at: string; note: string } | null;
}

/** Encrypted alongside the document; a source replacement discards the entire ledger. */
export interface RecoveryLedger {
  version: 1;
  sourceRevision: string;
  attempts: Record<string, number>;
  proposals: StoredRecoveryProposal[];
  job: {
    id: string;
    page: number;
    state: 'working' | 'ready' | 'error';
    message: string | null;
    startedAt: string;
    finishedAt: string | null;
  } | null;
  updatedAt: string;
}

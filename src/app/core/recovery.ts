type Tuple4 = [number, number, number, number];

/** Mirrors the public recovery contract in api/src/recovery/contract.ts. */
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

export interface RecoveryStartRequest { page: number; expectedRevision: string }
export interface RecoveryAcceptRequest { expectedRevision: string; note: string }
export interface RecoveryRejectRequest { expectedRevision: string }

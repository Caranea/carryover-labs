/**
 * Extracted lab results. Mirrors api/src/results/contract.ts; keep the two in sync.
 */
import type { SourceKind } from './models';

export type Language = 'pl' | 'de' | 'en' | 'unknown';
export type Flag = 'H' | 'L' | 'HH' | 'LL' | 'A';

export interface DocumentLocale {
  language: Language;
  decimal: ',' | '.';
  dateOrder: 'DMY' | 'MDY' | 'YMD';
  ambiguousDateOrder?: boolean;
  collectionDate: string | null;
  collectionDateSource: 'label' | 'document' | null;
}

export interface Observation {
  id: string;
  documentId: string;
  page: number;
  bbox: [number, number, number, number] | null;
  words: number[];
  name: string;
  value: number | null;
  valueText: string;
  comparator: '<' | '>' | '≤' | '≥' | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  refText: string | null;
  flag: Flag | null;
  date: string | null;
  dateSource: 'label' | 'document' | 'user' | null;
  original?: ObservationFields;
  corrections?: ObservationCorrection[];
  revision?: string;
  confirmed?: boolean;
  recovery?: {
    proposalId: string;
    sourceRevision: string;
    model: string;
    acceptedAt: string;
    note: string;
    evidence: { name: number[]; value: number[]; unit: number[]; date: number[]; reference: number[] };
  };
  /** OCR slips corrected on scanned pages, with what OCR actually read. Absent when nothing was changed. */
  ocrFixes?: OcrFix[];
}

export interface OcrFix {
  field: 'value' | 'range' | 'unit';
  read: string;
}

export interface ObservationFields {
  name: string;
  valueText: string;
  unit: string | null;
  date: string | null;
}

export interface ObservationCorrection {
  at: string;
  note: string;
  changes: Partial<ObservationFields>;
}

export interface CorrectionRequest extends ObservationFields {
  note: string;
  expectedRevision: string;
}

export interface ResultIssue {
  documentId: string;
  documentName: string;
  message: string;
}

export interface ResultsDocument {
  id: string;
  name: string;
  sourceKind: SourceKind;
  pageCount: number;
  locale: DocumentLocale;
  count: number;
}

export interface ResultsResponse {
  documents: ResultsDocument[];
  observations: Observation[];
  issues?: ResultIssue[];
}

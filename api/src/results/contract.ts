/**
 * Extracted lab results. Mirrors src/app/core/results.ts in the Angular app;
 * keep the two in sync.
 */
import type { SourceKind, Tuple4 } from '../documents/contract.js';

export type Language = 'pl' | 'de' | 'en' | 'unknown';
export type DateOrder = 'DMY' | 'MDY' | 'YMD';
export type Flag = 'H' | 'L' | 'HH' | 'LL' | 'A';

export interface DocumentLocale {
  language: Language;
  /** Decimal separator most numbers on the document use. */
  decimal: ',' | '.';
  dateOrder: DateOrder;
  ambiguousDateOrder?: boolean;
  /** YYYY-MM-DD, from a collection label when possible. */
  collectionDate: string | null;
  collectionDateSource: 'label' | 'document' | null;
}

/** One printed result, exactly as the lab printed it, with where it came from. */
export interface Observation {
  /** `<document>:<page>:<line>` — stable while the document is unchanged. */
  id: string;
  documentId: string;
  /** Page index (0-based). */
  page: number;
  /** Union of the boxes of every word used, in page image pixels. Null for text-only documents. */
  bbox: Tuple4 | null;
  /** Indices into the page's word list. */
  words: number[];
  /** Exact approved OCR words selected during server extraction. */
  sourceEvidence?: { name: number[]; value: number[]; unit: number[]; date: number[]; reference: number[] };
  sourceImage?: { pageId: string; revision: string; row: number };
  /** Immutable Spark transcription, preserved even after a user correction. */
  transcription?: import('../demo/processing-contract.js').PrintedRow;
  /** The test name as printed, e.g. "TSH (ICD-9: L69)". */
  name: string;
  /** Numeric value, if the result is a number. */
  value: number | null;
  /** The value as printed, e.g. "1,59", "< 4", "Negative". */
  valueText: string;
  comparator: '<' | '>' | '≤' | '≥' | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  /** The reference range as printed. */
  refText: string | null;
  flag: Flag | null;
  date: string | null;
  dateSource: 'label' | 'document' | 'user' | null;
  /** The immutable extraction, before any user correction. */
  original?: ObservationFields;
  corrections?: ObservationCorrection[];
  /** Optimistic concurrency token for the correction endpoint. */
  revision?: string;
  /** True only after the user has checked this reading against its source. */
  confirmed?: boolean;
  /** An explicitly accepted recovery suggestion, still tied to its unchanged source words. */
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

export interface DocumentResults {
  documentId: string;
  extractorVersion: number;
  locale: DocumentLocale;
  observations: Observation[];
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

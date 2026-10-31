/**
 * The user's record: every recognised test as a series over time, grouped
 * into charts. Mirrors src/app/core/records.ts in the Angular app; keep the
 * two in sync.
 */
import type { Tuple4 } from './document.js';

/** Where a value was read: enough to open the page and outline the row. */
export interface SourceRef {
  observationId: string;
  documentId: string;
  documentName: string;
  page: number;
  bbox: Tuple4 | null;
  confirmed?: boolean;
}

export interface RecordPoint extends SourceRef {
  /** YYYY-MM-DD. */
  date: string;
  /** In the series unit. */
  value: number;
  comparator: '<' | '>' | '≤' | '≥' | null;
  /** As printed: name, value, unit and reference. */
  printedName: string;
  printedValue: string;
  printedUnit: string | null;
  printedReference: string | null;
  /** Set when the printed unit differed and the value was converted. */
  conversion: { from: string; factor: number } | null;
  /** The same value on the same date in other documents (a report uploaded twice). */
  alsoIn: SourceRef[];
}

export interface RecordSeries {
  key: string;
  label: string;
  unit: string;
  /** Every distinct printed name merged into this test: "Płytki krwi", "PLT", "Platelets". */
  printedNames: string[];
  points: RecordPoint[];
}

export interface RecordChart {
  id: string;
  unit: string;
  series: RecordSeries[];
}

export interface RecordDomain {
  key: string;
  label: string;
  charts: RecordChart[];
}

/** A result that is words, not a number: "niereaktywny", "Negative". */
export interface TextResult extends SourceRef {
  key: string;
  label: string;
  date: string | null;
  printedName: string;
  printedValue: string;
}

export type WarningReason =
  | 'unrecognised' // not a test in the catalogue, and not mapped by the model (yet)
  | 'not-a-test' // the model says the name is not a lab test (OCR noise, a heading)
  | 'implausible' // outside automated verification bounds; requires source confirmation
  | 'unit' // the unit cannot be converted to the test's unit
  | 'no-date' // the document has no date
  | 'model'; // flagged by the model's review

/** A row kept out of the charts, with the reason, so nothing disappears silently. */
export interface RecordWarning extends SourceRef {
  reason: WarningReason;
  detail: string;
  /** 'rules' or 'model'. */
  by: 'rules' | 'model';
  printedName: string;
  printedValue: string;
  printedUnit: string | null;
  date: string | null;
}

export interface ModelStatus {
  /** 'off': no keys set; 'working': a check is running; 'ready': nothing left to ask; 'error': the last call failed. */
  state: 'off' | 'working' | 'ready' | 'error';
  name: string | null;
  /** Names, conversions and documents still waiting for the model. */
  waiting: number;
  message: string | null;
}

export interface RecordsResponse {
  issues?: { documentId: string; documentName: string; message: string }[];
  domains: RecordDomain[];
  textResults: TextResult[];
  warnings: RecordWarning[];
  stats: {
    documents: number;
    tests: number;
    values: number;
    from: string | null;
    to: string | null;
  };
  model: ModelStatus;
}

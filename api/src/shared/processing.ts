import type { Observation } from './results.js';

/** Bump when cached browser results need fresh server extraction. */
export const PROCESSING_VERSION = 3;

/** What a printed date records, from best to last resort for placing a result in time. */
export const DATE_KINDS = ['collected', 'received', 'performed', 'registered', 'reported'] as const;
export type DateKind = (typeof DATE_KINDS)[number];
export interface PrintedDate {
  kind: DateKind;
  printed: string;
  /** YYYY-MM-DD when unambiguous. */
  iso: string | null;
}
/** A date printed on a page outside the result rows: a header, footer or notes table. */
export interface PageDate extends PrintedDate {
  /** The footnote marker of the tests it belongs to; null for the whole report. */
  marker: string | null;
}
export interface PrintedRow {
  name: string | null;
  /** A footnote or reference marker printed with the test, linking it to notes or dates. */
  marker: string | null;
  /** The printed section heading the row is under ("Morfologia krwi"). */
  section: string | null;
  value: string | null;
  unit: string | null;
  reference: string | null;
  flag: string | null;
  specimen: string | null;
  /** A date printed on the row itself. */
  date: PrintedDate | null;
  region: [number, number, number, number] | null;
  /** Set only when this row's own name, value, unit or reference is hard to read. */
  doubt: string | null;
}
export interface PageRequest {
  batchId: string;
  documentId: string;
  pageId: string;
  page: number;
  revision: string;
  image: string;
  /** A sample patient page ("jane-doe-039:0"): answered from its recording, never live. */
  sample?: string;
}
export interface PageTranscription extends Omit<PageRequest, 'image'> {
  version: number;
  rows: PrintedRow[];
  observations: Observation[];
  dates: PageDate[];
  suggestedName: string | null;
}

import type { Observation } from './results.js';

/** Bump when cached browser results need fresh server extraction. */
export const PROCESSING_VERSION = 2;
export interface PrintedDate {
  printed: string | null;
  iso: string | null;
}
export interface PrintedRow {
  name: string | null;
  value: string | null;
  unit: string | null;
  reference: string | null;
  flag: string | null;
  collectionDate: PrintedDate;
  orderDate: PrintedDate;
  reportDate: PrintedDate;
  specimen: string | null;
  method: string | null;
  region: [number, number, number, number] | null;
  uncertainty: string[];
}
export interface PageRequest {
  batchId: string;
  documentId: string;
  pageId: string;
  page: number;
  revision: string;
  image: string;
}
export interface PageTranscription extends Omit<PageRequest, 'image'> {
  version: number;
  rows: PrintedRow[];
  observations: Observation[];
  issues: string[];
  suggestedName: string | null;
}

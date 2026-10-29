/**
 * What the browser uploads. Mirrors src/app/core/models.ts in the Angular app;
 * keep the two in sync.
 */
export type SourceKind = 'pdf' | 'image' | 'docx' | 'text';

export const SOURCE_KINDS: SourceKind[] = ['pdf', 'image', 'docx', 'text'];

export const PII_KINDS = [
  'person',
  'address',
  'national-id',
  'id-number',
  'contact',
  'birth-date',
  'age',
  'other',
] as const;
export type PiiKind = (typeof PII_KINDS)[number];

export type Tuple4 = [number, number, number, number];

export interface StoredWord {
  t: string | null;
  b?: Tuple4;
  l: number;
  h?: true;
  k?: PiiKind;
}

export interface StoredPage {
  index: number;
  width: number;
  height: number;
  hasImage: boolean;
  ocr: boolean;
  words: StoredWord[];
  regions: Tuple4[];
}

export interface DocumentManifest {
  name: string;
  sourceKind: SourceKind;
  pages: StoredPage[];
  hiddenCount: number;
}

export interface SavedDocumentSummary {
  id: string;
  name: string;
  sourceKind: SourceKind;
  pageCount: number;
  hiddenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedDocument extends SavedDocumentSummary {
  pages: StoredPage[];
}

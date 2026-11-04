/** Axis-aligned box in page pixel coordinates (origin top-left). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SourceKind = 'pdf' | 'image' | 'docx' | 'text';

/** What kind of personal data a hidden word was. Never the data itself. */
export type PiiKind =
  'person' | 'address' | 'national-id' | 'id-number' | 'contact' | 'birth-date' | 'age' | 'other';

export interface WorkingWord {
  id: number;
  /** Null once the word has been removed (a saved document never carries hidden text). */
  text: string | null;
  /** Absent for text-only sources (DOCX, TXT). */
  box?: Box;
  line: number;
  hidden: boolean;
  /** Hidden on the server already; cannot be revealed again. */
  locked?: boolean;
  kind?: PiiKind;
}

export interface WorkingPage {
  index: number;
  width: number;
  height: number;
  /** Rendered page image, original (local only, never uploaded as-is). */
  image: Blob | null;
  imageUrl: string | null;
  words: WorkingWord[];
  /** Boxes the user drew by hand; burned into the image like hidden words. */
  regions: Box[];
  /** The first N regions are already burned into a saved image and cannot be removed. */
  lockedRegions?: number;
  ocr: boolean;
}

export type LocalStatus =
  'queued' | 'reading' | 'detecting' | 'review' | 'saving' | 'saved' | 'error';

export interface LocalDocument {
  localId: string;
  /** Present only for documents opened from the account (resubmission). */
  serverId?: string;
  /** Title stored with the document; defaults to a neutral title independent of the filename. */
  name: string;
  /** App-generated title: fixed test labels and a visible, explicitly labelled report date. */
  generatedName?: string;
  /** Original file name, shown on this device only. */
  fileName: string;
  sourceKind: SourceKind;
  status: LocalStatus;
  progress: number;
  message: string;
  error?: string;
  /** Version of the review flow these pages were prepared under. */
  privacyVersion?: number;
  pages: WorkingPage[];
  file: File | null;
  /** A sample patient document (its DEMO_DOCUMENTS id): read from its recorded answers, never live. */
  sample?: string;
  addedAt: number;
}

// ---------------------------------------------------------------------------
// Upload contract (what actually leaves the device). Keep in sync with api/.
// ---------------------------------------------------------------------------

export interface StoredWord {
  /** Null when hidden. */
  t: string | null;
  /** [x, y, w, h], rounded to whole pixels. Absent for text-only sources. */
  b?: [number, number, number, number];
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
  regions: [number, number, number, number][];
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
  /** Browser-only display metadata; never part of an uploaded document or AI request. */
  originalFileName?: string;
  sourceKind: SourceKind;
  pageCount: number;
  hiddenCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SavedDocument extends SavedDocumentSummary {
  pages: StoredPage[];
}

/** Axis-aligned box in page pixel coordinates (origin top-left). */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type SourceKind = 'pdf' | 'image' | 'docx' | 'text';
/** Lightweight is manual review: neither the model nor pattern rules run. */
export type PrivacyMode = 'automatic' | 'lightweight';

/** What kind of personal data a hidden word was. Never the data itself. */
export type PiiKind =
  | 'person'
  | 'address'
  | 'national-id'
  | 'id-number'
  | 'contact'
  | 'birth-date'
  | 'age'
  | 'other';

/** Who decided a word is hidden. */
export type DetectionSource = 'model' | 'rule' | 'you' | 'remembered';

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
  /** The user toggled this word by hand; detection must not override it. */
  userSet?: boolean;
  kind?: PiiKind;
  source?: DetectionSource;
  score?: number;
  /** Local model evidence, retained for review/re-evaluation; never in the saved manifest. */
  prediction?: { label: string; score: number };
  /** An uncertain suggestion stays visible, highlighted in the review only. */
  candidate?: PiiKind;
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
  | 'queued'
  | 'reading'
  | 'detecting'
  | 'review'
  | 'saving'
  | 'saved'
  | 'error';

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
  /** The last detection pass used the stricter settings. */
  strict: boolean;
  progress: number;
  message: string;
  error?: string;
  /** Per-document result: global model readiness does not prove this document was checked. */
  privacyCheck?: 'complete' | 'incomplete' | 'manual';
  privacyMessage?: string;
  privacyMode?: PrivacyMode;
  /** Explicit acknowledgement is required for manual or incomplete automatic checks. */
  privacyAcknowledged?: boolean;
  /** Version of the rules and model interpretation used for these OCR words. */
  privacyVersion?: number;
  pages: WorkingPage[];
  file: File | null;
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

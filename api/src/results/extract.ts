import type { SavedDocument } from '../documents/contract.js';
import type { DocumentResults } from './contract.js';
import { detectLocale } from './locale.js';
import { extractPage } from './rows.js';

/** Bump when extraction changes, so cached results are recomputed. */
export const EXTRACTOR_VERSION = 4;

/** Deterministic extraction of printed results from a saved (redacted) document. */
export function extractDocument(doc: SavedDocument): DocumentResults {
  const locale = detectLocale(doc.pages);
  const observations = doc.pages.flatMap((page, p) => extractPage(doc.id, p, page, detectLocale([page])));
  return { documentId: doc.id, extractorVersion: EXTRACTOR_VERSION, locale, observations };
}

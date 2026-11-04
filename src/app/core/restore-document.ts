import { PRIVACY_VERSION } from '../pii/privacy-version';
import { LocalDocument, SavedDocumentSummary } from './models';

/**
 * A document as it comes back from the checkpoint after a refresh: approved ones are marked
 * saved, page images get fresh object URLs, interrupted work is queued again, and pages
 * prepared under an older flow go back to review with their masks intact.
 */
export function restoredDocument(
  doc: LocalDocument,
  saved: SavedDocumentSummary | undefined,
): LocalDocument {
  if (saved)
    return {
      ...doc,
      status: 'saved',
      serverId: saved.id,
      pages: [],
      file: null,
      error: undefined,
    };
  const pages = doc.pages.map((page) => ({
    ...page,
    imageUrl: page.image ? URL.createObjectURL(page.image) : null,
  }));
  const file = doc.file ? new File([doc.file], doc.fileName, { type: doc.file.type }) : null;
  if (
    !doc.serverId &&
    doc.status !== 'saved' &&
    doc.privacyVersion !== PRIVACY_VERSION &&
    pages.length
  )
    return {
      ...doc,
      file,
      pages,
      privacyVersion: PRIVACY_VERSION,
      status: 'review',
      progress: 1,
      message: '',
    };
  if (['queued', 'reading', 'detecting'].includes(doc.status))
    return {
      ...doc,
      file,
      pages,
      status: 'queued',
      progress: 0,
      message: 'Waiting to resume',
    };
  return {
    ...doc,
    file,
    pages,
    status: doc.status === 'saving' ? 'review' : doc.status,
    message: '',
  };
}

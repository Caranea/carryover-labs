import { deleteDeviceDatabase } from './device-storage';
import { forgetServerBatch } from './job-client';

const PREFIX = 'carryover.';
/** Survives the reload that follows, so the next page can confirm what happened. */
export const CLEARED_FLAG = 'carryover.cleared';

/**
 * Delete everything Carryover keeps in this browser: approved documents and their page images,
 * results and corrections, files waiting for review, and the details remembered for hiding.
 * The downloaded privacy checker (Cache Storage) stays: it holds no personal data.
 */
export async function clearLocalData(): Promise<void> {
  // Pages the server may still hold for this browser are dropped too (best effort).
  await forgetServerBatch();
  await deleteDeviceDatabase();
  for (const storage of [localStorage, sessionStorage]) {
    for (const key of Object.keys(storage)) if (key.startsWith(PREFIX)) storage.removeItem(key);
  }
  sessionStorage.setItem(CLEARED_FLAG, '1');
}

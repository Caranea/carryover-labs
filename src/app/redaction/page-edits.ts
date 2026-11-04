import { Box, WorkingPage } from '../core/models';
import { applyRegion, removeRegion } from './burn';

/**
 * Hand edits as pure functions over a document's pages. Each returns the same array when
 * nothing changed, so the caller can tell an edit from a no-op.
 */

/** Draw an area to black out. Slivers smaller than 4 px are ignored as stray taps. */
export function addArea(pages: WorkingPage[], pageIndex: number, area: Box): WorkingPage[] {
  if (area.w < 4 || area.h < 4) return pages;
  return pages.map((p, i) => (i === pageIndex ? applyRegion(p, area) : p));
}

/** Remove a drawn area; areas already burned into a saved copy stay. */
export function removeArea(pages: WorkingPage[], pageIndex: number, index: number): WorkingPage[] {
  return pages.map((p, i) =>
    i === pageIndex && index >= (p.lockedRegions ?? 0) && index < p.regions.length
      ? removeRegion(p, index)
      : p,
  );
}

/** Release the page images' object URLs. */
export function revokePageUrls(pages: WorkingPage[]) {
  for (const p of pages) if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
}

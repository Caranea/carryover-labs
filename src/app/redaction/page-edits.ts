import { Box, WorkingPage, WorkingWord } from '../core/models';
import { applyRegion, removeRegion } from './burn';
import { intersects } from './geometry';

/**
 * Hand edits as pure functions over a document's pages. Each returns the same array when
 * nothing changed, so the caller can tell an edit from a no-op.
 */

/** Hide or show one word, by hand. Words under a drawn area stay hidden until it is removed. */
export function toggleWord(pages: WorkingPage[], pageIndex: number, wordId: number): WorkingPage[] {
  const word = pages[pageIndex]?.words.find((w) => w.id === wordId);
  if (!word || word.locked || word.text === null) return pages;
  // A region remains opaque until removed. Keeping its text must not change the upload.
  if (word.box && pages[pageIndex].regions.some((r) => intersects(word.box!, r))) return pages;
  const hide = !word.hidden;
  return pages.map((page, p) => ({
    ...page,
    words: page.words.map((w): WorkingWord => {
      if (p !== pageIndex || w.id !== wordId) return w;
      return hide
        ? {
            ...w,
            hidden: true,
            userSet: true,
            source: 'you',
            kind: w.kind ?? w.candidate ?? 'other',
            candidate: undefined,
          }
        : {
            ...w,
            hidden: false,
            userSet: true,
            source: undefined,
            kind: undefined,
            candidate: undefined,
          };
    }),
  }));
}

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

import { Box, DocumentManifest, LocalDocument, StoredPage, WorkingPage } from '../core/models';
import { blobToCanvas, canvasToBlob } from '../extraction/render';
import { fromTuple, toTuple } from './geometry';
import { maskGeometry, pixelBox } from '../../../api/src/documents/mask-geometry';
export { redactionPadding } from '../../../api/src/documents/mask-geometry';

/** Boxes are grown a little so OCR boxes that hug the glyphs still cover them fully. */
export function redactionPlan(page: WorkingPage) {
  return maskGeometry(page.width, page.height, page.words, page.regions);
}

/** Covered neighbours undo their initiating mask, without becoming new permanent masks. */
export function redactionAction(page: WorkingPage, index: number, plan = redactionPlan(page)): { wordId: number } | { regionIndex: number } | null {
  if (!page.words[index]) return null;
  const origin = plan.origins.get(index) ?? index;
  if (origin >= 0) return page.words[origin]?.locked ? null : { wordId: page.words[origin].id };
  const regionIndex = -origin - 1;
  return regionIndex < (page.lockedRegions ?? 0) ? null : { regionIndex };
}

/** Every box that must be blacked out on a page. */
export function boxesToBurn(page: WorkingPage): Box[] {
  return redactionPlan(page).boxes;
}

/** Final geometry is authoritative, even when a word's toggle was changed afterwards. */
export function isCovered(page: WorkingPage, word: WorkingPage['words'][number]): boolean {
  return redactionPlan(page).hidden.has(page.words.indexOf(word));
}

/**
 * Paint solid black over every hidden word and drawn region, then re-encode.
 * The result is a new PNG made only from pixels: no text layer, no metadata,
 * nothing under the boxes to recover.
 */
export async function burnPage(page: WorkingPage): Promise<Blob | null> {
  if (!page.image) return null;
  const canvas = await blobToCanvas(page.image);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  for (const b of boxesToBurn(page)) ctx.fillRect(b.x, b.y, b.w, b.h);
  const blob = await canvasToBlob(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return blob;
}

/** The text that is uploaded: hidden words carry no text at all. */
export function toStoredPage(page: WorkingPage): StoredPage {
  const plan = redactionPlan(page);
  return {
    index: page.index,
    width: page.width,
    height: page.height,
    hasImage: !!page.image,
    ocr: page.ocr,
    words: page.words.map((w, index) => {
      const box = w.box ? pageBox(page, w.box) : undefined;
      const hidden = plan.hidden.has(index);
      return {
        t: hidden ? null : w.text,
        ...(box ? { b: toTuple(box) } : {}),
        l: w.line,
        ...(hidden ? { h: true as const } : {}),
        ...(hidden && w.kind ? { k: w.kind } : {}),
      };
    }),
    regions: page.regions.map((box) => toTuple(pageBox(page, box))),
  };
}

/** Use the same integer pixel geometry for the burned image and transmitted text. */
function pageBox(page: WorkingPage, box: Box): Box {
  return pixelBox(page.width, page.height, box);
}

export function buildManifest(doc: LocalDocument, name: string): DocumentManifest {
  const pages = doc.pages.map(toStoredPage);
  const hiddenCount = pages.reduce((n, p) => n + p.words.filter((w) => w.h).length + p.regions.length, 0);
  return { name, sourceKind: doc.sourceKind, pages, hiddenCount };
}

/** Region coverage is derived, so Undo restores earlier explicit word choices. */
export function applyRegion(page: WorkingPage, region: Box): WorkingPage {
  return { ...page, regions: [...page.regions, region] };
}

export function removeRegion(page: WorkingPage, index: number): WorkingPage {
  return { ...page, regions: page.regions.filter((_, i) => i !== index) };
}

export { fromTuple };

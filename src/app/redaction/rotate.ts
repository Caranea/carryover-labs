import { Box, WorkingPage } from '../core/models';
import { blobToCanvas, canvasToBlob, createCanvas } from '../extraction/render';

/** A quarter turn: 1 is clockwise, -1 counter-clockwise. */
export type Turn = 1 | -1;

/** Where a box lands after turning a width × height page a quarter turn. */
export function turnBox(box: Box, width: number, height: number, turn: Turn): Box {
  return turn === 1
    ? { x: height - (box.y + box.h), y: box.x, w: box.h, h: box.w }
    : { x: box.y, y: width - (box.x + box.w), w: box.h, h: box.w };
}

/**
 * The page's geometry turned a quarter: size, word boxes and drawn areas. Masks stay over
 * exactly what they covered. Nothing is detected again; the person checks the turned page.
 */
export function turnPageGeometry(page: WorkingPage, turn: Turn): WorkingPage {
  const { width, height } = page;
  return {
    ...page,
    width: height,
    height: width,
    words: page.words.map((w) => (w.box ? { ...w, box: turnBox(w.box, width, height, turn) } : w)),
    regions: page.regions.map((r) => turnBox(r, width, height, turn)),
  };
}

/** The page image turned a quarter, re-encoded like every other page image. */
export async function turnImage(image: Blob, turn: Turn): Promise<Blob> {
  const source = await blobToCanvas(image);
  const canvas = createCanvas(source.height, source.width);
  const ctx = canvas.getContext('2d')!;
  ctx.translate(turn === 1 ? canvas.width : 0, turn === 1 ? 0 : canvas.height);
  ctx.rotate((turn * Math.PI) / 2);
  ctx.drawImage(source, 0, 0);
  source.width = source.height = 0;
  try {
    return await canvasToBlob(canvas, 'image/jpeg', 0.92);
  } finally {
    canvas.width = canvas.height = 0;
  }
}

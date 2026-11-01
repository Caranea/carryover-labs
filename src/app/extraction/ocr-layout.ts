import type Tesseract from 'tesseract.js';
import type { Box, WorkingWord } from '../core/models';
import { assignLines } from './layout';

/**
 * Flatten tesseract's block tree into reading-order words with line numbers.
 *
 * Tesseract often puts table columns in separate blocks, which would split a
 * result row ("PLT | 245 | tys/µl") into three lines. Its lines are therefore
 * merged into visual rows by vertical position, keeping each tesseract line
 * (which follows the page's slant) intact.
 */
export function pageToWords(page: Tesseract.Page, startId: number): WorkingWord[] {
  const lines: { box: Box; words: { text: string; box: Box }[] }[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const l of paragraph.lines) {
        const words = l.words
          .filter((w) => w.text.trim() && w.confidence >= 0)
          .map((w) => ({ text: w.text.trim(), box: bboxToBox(w.bbox) }));
        if (words.length) lines.push({ box: bboxToBox(l.bbox), words });
      }
    }
  }

  const rows = assignLines(lines);
  const out: WorkingWord[] = [];
  let id = startId;
  for (const row of rows) {
    for (const w of row.words)
      out.push({ id: id++, text: w.text, box: w.box, line: row.line, hidden: false });
  }
  return out;
}

function bboxToBox(b: Tesseract.Bbox): Box {
  return { x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 };
}

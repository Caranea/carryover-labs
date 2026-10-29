import { Box, WorkingWord } from '../core/models';

/** A run of text with a box, as produced by a PDF text layer. */
export interface TextRun {
  text: string;
  box: Box;
}

/**
 * Split PDF text runs into words with estimated boxes and group them into lines.
 *
 * pdf.js gives runs (often whole phrases); character widths are estimated
 * proportionally, which is precise enough for redaction boxes once padded.
 */
export function runsToWords(runs: TextRun[], startId = 0): WorkingWord[] {
  const pieces: { text: string; box: Box }[] = [];

  for (const run of runs) {
    const chars = run.text.length;
    if (!chars || run.box.w <= 0) continue;
    const charW = run.box.w / chars;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(run.text)) !== null) {
      pieces.push({
        text: m[0],
        box: {
          x: run.box.x + m.index * charW,
          y: run.box.y,
          w: m[0].length * charW,
          h: run.box.h,
        },
      });
    }
  }

  return assignLines(pieces).map((p, i) => ({
    id: startId + i,
    text: p.text,
    box: p.box,
    line: p.line,
    hidden: false,
  }));
}

/**
 * Group boxes into reading-order lines: sort by vertical centre, start a new
 * line when the centre moves by more than half a text height, then sort each
 * line left to right.
 */
export function assignLines<T extends { box: Box }>(items: T[]): (T & { line: number })[] {
  const sorted = [...items].sort((a, b) => centre(a.box) - centre(b.box));
  const lines: T[][] = [];
  let current: T[] = [];
  let currentCentre = -Infinity;
  let currentHeight = 0;

  for (const item of sorted) {
    const c = centre(item.box);
    if (current.length && Math.abs(c - currentCentre) > Math.max(currentHeight, item.box.h) * 0.5) {
      lines.push(current);
      current = [];
    }
    if (!current.length) {
      currentCentre = c;
      currentHeight = item.box.h;
    }
    current.push(item);
  }
  if (current.length) lines.push(current);

  return lines.flatMap((line, lineIndex) =>
    [...line].sort((a, b) => a.box.x - b.box.x).map((item) => ({ ...item, line: lineIndex })),
  );
}

/** Words from plain text (DOCX, TXT): no boxes, one line per text line. */
export function textToWords(text: string, startId = 0): WorkingWord[] {
  const words: WorkingWord[] = [];
  let id = startId;
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((lineText, line) => {
      for (const token of lineText.split(/\s+/)) {
        if (token) words.push({ id: id++, text: token, line, hidden: false });
      }
    });
  return words;
}

function centre(box: Box): number {
  return box.y + box.h / 2;
}

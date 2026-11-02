import { Box } from '../core/models';

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

function centre(box: Box): number {
  return box.y + box.h / 2;
}

import type { StoredPage, Tuple4 } from '../documents/contract.js';

/** A visible word on a page with its index in the stored word list. */
export interface Tok {
  i: number;
  text: string;
  box: Tuple4 | null;
  line: number;
}

/** Visible words grouped into lines, left to right. Hidden words are skipped. */
export function linesOf(page: StoredPage): Tok[][] {
  const map = new Map<number, Tok[]>();
  page.words.forEach((w, i) => {
    if (w.t === null) return;
    const list = map.get(w.l) ?? [];
    list.push({ i, text: w.t, box: w.b ?? null, line: w.l });
    map.set(w.l, list);
  });
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, toks]) => (toks.every((t) => t.box) ? toks.sort((a, b) => a.box![0] - b.box![0]) : toks));
}

export function unionBox(toks: Tok[]): Tuple4 | null {
  const boxes = toks.map((t) => t.box).filter((b): b is Tuple4 => b !== null);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b[0]));
  const y0 = Math.min(...boxes.map((b) => b[1]));
  const x1 = Math.max(...boxes.map((b) => b[0] + b[2]));
  const y1 = Math.max(...boxes.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

export function textOf(toks: Tok[]): string {
  return toks.map((t) => t.text).join(' ');
}

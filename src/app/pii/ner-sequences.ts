/**
 * Word-aligned sequence building for token classification. Kept free of any
 * model code so it can be unit tested.
 */

/** XLM-RoBERTa allows 512 positions; leave room for the special tokens. */
export const MAX_TOKENS = 500;
/** OCR garbage can tokenise into dozens of pieces; the first few are enough. */
export const MAX_TOKENS_PER_WORD = 24;

export interface WordSpan {
  /** Index into the flat word list. */
  word: number;
  /** Token offsets within the sequence (after the prefix). */
  start: number;
  end: number;
}

export interface Sequence {
  ids: number[];
  spans: WordSpan[];
}

/**
 * Pack lines of words into sequences of at most MAX_TOKENS, never splitting a
 * line unless the line alone is too long. Neighbouring lines give the model
 * context ("Lekarz:" on one line, the name on the next).
 */
export function buildSequences(
  lines: string[][],
  encodeWord: (word: string) => number[],
  prefix: number[],
  suffix: number[],
  maxTokens = MAX_TOKENS,
): Sequence[] {
  const budget = maxTokens - prefix.length - suffix.length;
  const sequences: Sequence[] = [];
  let ids: number[] = [];
  let spans: WordSpan[] = [];
  let wordIndex = 0;

  const flush = () => {
    if (spans.length) sequences.push({ ids: [...prefix, ...ids, ...suffix], spans });
    ids = [];
    spans = [];
  };

  for (const line of lines) {
    const encoded = line.map((w) => encodeWord(w).slice(0, MAX_TOKENS_PER_WORD));
    const lineTokens = encoded.reduce((n, e) => n + Math.max(1, e.length), 0);
    if (ids.length + lineTokens > budget) flush();

    encoded.forEach((tokens) => {
      const t = tokens.length ? tokens : [];
      if (ids.length + t.length > budget) flush();
      const start = ids.length + prefix.length;
      ids.push(...t);
      spans.push({ word: wordIndex++, start, end: start + t.length });
    });
  }
  flush();
  return sequences;
}

/**
 * Some PDFs carry a text layer that is unusable: fonts embedded without a
 * character map turn "Hemoglobina" into "! " #$ %&'", and some generators
 * shift characters ("XOSURI0LFKD"). Such pages must be read with OCR instead.
 *
 * A page's text layer is trusted only when most tokens look like real words
 * or numbers and few look scrambled.
 */
export interface TextQuality {
  tokens: number;
  /** Share of tokens that are plain words, numbers or dates. */
  good: number;
  /** Share of tokens with scrambled letter case or letters mixed with digits. */
  weird: number;
}

const WORD = /^[\p{L}µ]{2,}$/u;
const NUMBER = /^[<>≤≥]?\d+(?:[.,]\d+)?%?$/;
const DATE = /^\d{1,4}[-./]\d{1,2}[-./]\d{1,4}$/;

export function textQuality(text: string): TextQuality {
  const tokens = text.split(/\s+/).filter(Boolean);
  let good = 0;
  let weird = 0;
  for (const raw of tokens) {
    const core = raw.replace(/^[.,:;()[\]*"'„”]+|[.,:;()[\]*"'„”]+$/g, '');
    if (WORD.test(core)) {
      const lower = core.toLocaleLowerCase();
      const upper = core.toLocaleUpperCase();
      const title = core[0] + core.slice(1).toLocaleLowerCase();
      if (core === lower || core === upper || core === title) good++;
      else weird++;
    } else if (NUMBER.test(core) || DATE.test(core)) {
      good++;
    } else if (/\p{L}/u.test(core) && /\d/.test(core) && core.length > 5) {
      weird++;
    }
  }
  const n = Math.max(1, tokens.length);
  return { tokens: tokens.length, good: good / n, weird: weird / n };
}

export function textLayerIsUsable(text: string): boolean {
  const q = textQuality(text);
  return q.tokens >= 8 && q.good >= 0.6 && q.weird <= 0.08;
}

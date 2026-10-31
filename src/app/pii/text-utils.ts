/** Lowercase, strip diacritics (including Polish ł) and surrounding punctuation. */
export function normalizeToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '')
    .replace(/\.$/, '');
}

export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/** Classic Levenshtein distance, capped for speed. */
export function levenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > cap) return cap + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Polish PESEL: 11 digits with a valid checksum. */
export function isValidPesel(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(digits[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/**
 * Parse common date spellings (31.12.1990, 1990-12-31, 31/12/1990, 31-12-1990)
 * into YYYY-MM-DD. Day-first is assumed for dotted and slashed forms.
 */
export function parseDate(raw: string): string | null {
  const s = raw.replace(/[,;]$/, '');
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isDateToken(raw: string): boolean {
  return parseDate(raw) !== null;
}

/** Units seen on Polish, German and Australian lab printouts. */
const UNIT_RE =
  /^(?:[a-zµμ]{0,3}g\/[dm]?l|[mµμnp]?mol\/l|[mµμ]?u\/m?l|[mµμ]?iu\/m?l|i?u\/l|tys\.?\/[µμu]l|mln\.?\/[µμu]l|tsd\.?\/[µμu]l|mio\.?\/[µμu]l|(?:x?10\^?\d{1,2}|g|t)\/l|\/[µμu]l|fl|pg|sek|s|mm\/h|mm\/godz|%|‰|inr|ratio|g\/l|mg\/l|ng\/ml|pg\/ml|µg\/l|ug\/l|mmhg|mosm\/kg|e\/l|kU\/l)$/i;

export function isUnitToken(raw: string): boolean {
  // OCR and PDF text may use superscripts, a multiplication sign, or separate
  // words for the exponent and slash: "× 10⁹ / L" is the same unit as "x10^9/L".
  return UNIT_RE.test(
    raw
      .normalize('NFKC')
      .replace(/[×·]/g, 'x')
      .replace(/[\s()[\],;]/g, ''),
  );
}

/** Word indices belonging to a complete unit, including units split by OCR. */
export function unitTokenIndices(texts: readonly string[]): Set<number> {
  const found = new Set<number>();
  for (let i = 0; i < texts.length; i++) {
    for (let end = i + 1; end <= Math.min(texts.length, i + 7); end++) {
      if (isUnitToken(texts.slice(i, end).join(' '))) for (let j = i; j < end; j++) found.add(j);
    }
  }
  return found;
}

/** Lab flags only make a word safe when it belongs to a recognised result row. */
export function isResultFlag(raw: string): boolean {
  return /^(?:H{1,2}|L{1,2}|N|A|ABN|↑{1,2}|↓{1,2})$/i.test(raw.replace(/[()[\]*]/g, ''));
}

/** A lab value: optional comparator, number with . or , decimals. */
export function isNumericValue(raw: string): boolean {
  return /^[<>≤≥]?\d+(?:[.,]\d+)?(?:[*!]|H{1,2}|L{1,2}|↑{1,2}|↓{1,2})?$/i.test(
    raw.replace(/[()[\],;]$/g, ''),
  );
}

/** A reference range written in one token, e.g. 150-400 or 4,0-10,0. */
export function isRangeToken(raw: string): boolean {
  return /^\(?\d{1,5}(?:[.,]\d+)?[-–]\d{1,5}(?:[.,]\d+)?\)?$/.test(raw);
}

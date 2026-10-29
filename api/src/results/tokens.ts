/** Token-level helpers for reading lab printouts in Polish, German and English. */
import type { DateOrder, Flag } from './contract.js';

export function norm(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[łŁ]/g, 'l')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, januar: 1, sty: 1, stycznia: 1,
  feb: 2, february: 2, februar: 2, lut: 2, lutego: 2,
  mar: 3, march: 3, mar_: 3, marz: 3, maerz: 3, mrz: 3,
  apr: 4, april: 4, kwi: 4, kwietnia: 4,
  may: 5, mai: 5, maj: 5, maja: 5,
  jun: 6, june: 6, juni: 6, cze: 6, czerwca: 6,
  jul: 7, july: 7, juli: 7, lip: 7, lipca: 7,
  aug: 8, august: 8, sie: 8, sierpnia: 8,
  sep: 9, sept: 9, september: 9, wrz: 9, wrzesnia: 9,
  oct: 10, october: 10, okt: 10, oktober: 10, paz: 10, pazdziernika: 10,
  nov: 11, november: 11, lis: 11, listopada: 11,
  dec: 12, december: 12, dez: 12, dezember: 12, gru: 12, grudnia: 12,
};

export interface DateParts {
  a: number;
  b: number;
  c: number;
  /** Which of a/b/c is the year, and whether the month was written as a name. */
  shape: 'YMD' | 'XXY' | 'DnameY';
}

/** Split a date-looking token without deciding day/month order yet. */
export function dateParts(raw: string): DateParts | null {
  const s = raw.replace(/[,;.]$/, '');
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (m) return { a: +m[1], b: +m[2], c: +m[3], shape: 'YMD' };
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})$/.exec(s);
  if (m) return { a: +m[1], b: +m[2], c: fullYear(+m[3]), shape: 'XXY' };
  m = /^(\d{1,2})[-. ]?([A-Za-zÀ-ž]{3,12})\.?[-. ]?(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const month = MONTHS[norm(m[2])];
    if (month) return { a: +m[1], b: month, c: fullYear(+m[3]), shape: 'DnameY' };
  }
  return null;
}

function fullYear(y: number): number {
  return y < 100 ? (y > 50 ? 1900 + y : 2000 + y) : y;
}

export function isDateLike(raw: string): boolean {
  return dateParts(raw) !== null;
}

export function toIsoDate(raw: string, order: DateOrder): string | null {
  const p = dateParts(raw);
  if (!p) return null;
  let y: number, mo: number, d: number;
  if (p.shape === 'YMD') [y, mo, d] = [p.a, p.b, p.c];
  else if (p.shape === 'DnameY') [y, mo, d] = [p.c, p.b, p.a];
  else if (order === 'MDY') [y, mo, d] = [p.c, p.a, p.b];
  else [y, mo, d] = [p.c, p.b, p.a];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCMonth() !== mo - 1) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isTimeLike(raw: string): boolean {
  return /^\d{1,2}:\d{2}(:\d{2})?$/.test(raw.replace(/[,;]$/, ''));
}

/** Parse "1,59", "4.82", "<0.50", "16,1H", "98*". Thousands separators are rare on lab results. */
export function parseNumber(raw: string): { value: number; comparator: '<' | '>' | '≤' | '≥' | null; flag: Flag | null } | null {
  let s = raw.trim().replace(/^[([]+|[)\]]+$/g, '');
  let comparator: '<' | '>' | '≤' | '≥' | null = null;
  const c = /^(<=|>=|[<>≤≥])\s*/.exec(s);
  if (c) {
    comparator = c[1] === '<=' ? '≤' : c[1] === '>=' ? '≥' : (c[1] as '<' | '>' | '≤' | '≥');
    s = s.slice(c[0].length);
  }
  let flag: Flag | null = null;
  const f = /(HH|LL|[HL↑↓])$/.exec(s);
  if (f && /\d/.test(s.slice(0, -f[0].length))) {
    flag = parseFlag(f[0]);
    s = s.slice(0, -f[0].length);
  }
  s = s.replace(/[*!]+$/, '');
  if (!/^[+-]?\d{1,9}(?:[.,]\d{1,9})?(?:[eE][+-]?\d{1,3})?$/.test(s)) return null;
  const value = Number(s.replace(',', '.'));
  return Number.isFinite(value) ? { value, comparator, flag } : null;
}

/** A value that is a number and not a date, time, year or identifier. */
export function isValueToken(raw: string): boolean {
  if (isDateLike(raw) || isTimeLike(raw)) return false;
  return parseNumber(raw) !== null;
}

const QUALITATIVE = new Set([
  'negative', 'positive', 'neg', 'pos', 'detected', 'reactive', 'nonreactive', 'non-reactive', 'normal', 'abnormal', 'trace', 'nil',
  'ujemny', 'ujemna', 'ujemne', 'dodatni', 'dodatnia', 'dodatnie', 'nieobecny', 'nieobecne', 'obecny', 'obecne', 'brak', 'slad', 'prawidlowy', 'prawidlowa',
  'niereaktywny', 'niereaktywna', 'niereaktywne', 'reaktywny', 'reaktywna', 'reaktywne', 'negatywny', 'negatywna', 'pozytywny', 'pozytywna',
  'negativ', 'positiv', 'reaktiv', 'unauffallig', 'nachweisbar', 'spuren',
]);

export function isQualitative(raw: string): boolean {
  return QUALITATIVE.has(norm(raw));
}

export function parseFlag(raw: string): Flag | null {
  const s = raw.trim().toUpperCase().replace(/[()*]/g, '');
  if (s === 'H' || s === '↑' || s === '+' || s === 'HIGH' || s === 'WYSOKI' || s === 'HOCH') return 'H';
  if (s === 'L' || s === '↓' || s === '-' || s === 'LOW' || s === 'NISKI' || s === 'NIEDRIG' || s === 'TIEF') return 'L';
  if (s === 'HH' || s === '↑↑') return 'HH';
  if (s === 'LL' || s === '↓↓') return 'LL';
  if (s === 'A' || s === 'ABN' || s === '!') return 'A';
  return null;
}

/** Parse a printed reference range: "0,35 - 4,94", "[3,9 - 10,2]", "< 0.50", "> 60", "do 5", "bis 1,0". */
export function parseRange(text: string): { low: number | null; high: number | null } | null {
  const clean = text.replace(/[[\](){}|]/g, ' ').replace(/\s+/g, ' ').trim();
  return rangeAt(clean) ?? rangeAt(clean.replace(/^[^\d<>≤≥]+/, '')) ?? rangeAnywhere(clean);
}

/** Last resort: "x 10^9/L 4.5 - 13.0" — the first "a - b" anywhere in the text. */
function rangeAnywhere(s: string): { low: number | null; high: number | null } | null {
  const m = /(?:^|\s)(\d{1,6}(?:[.,]\d{1,4})?)\s*[-–]\s*(\d{1,6}(?:[.,]\d{1,4})?)(?:\s|$)/.exec(s);
  return m ? { low: toNum(m[1]), high: toNum(m[2]) } : null;
}

function rangeAt(s: string): { low: number | null; high: number | null } | null {
  const num = '(\\d{1,6}(?:[.,]\\d{1,4})?)';
  let m = new RegExp(`^${num}\\s*(?:-|–|—|\\.\\.\\.|…|to|bis|do)\\s*${num}`, 'i').exec(s);
  if (m) return { low: toNum(m[1]), high: toNum(m[2]) };
  m = new RegExp(`^(?:<|≤|<=|do|bis|up to|below|ponizej|poniżej|unter)\\s*${num}`, 'i').exec(s);
  if (m) return { low: null, high: toNum(m[1]) };
  m = new RegExp(`^(?:>|≥|>=|od|ab|above|over|powyzej|powyżej|uber|über)\\s*${num}`, 'i').exec(s);
  if (m) return { low: toNum(m[1]), high: null };
  return null;
}

function toNum(s: string): number {
  return Number(s.replace(',', '.'));
}

/** Units seen on Polish, German and Australian printouts, plus a generic "x/y" shape. */
const UNIT_RE =
  /^(?:x\s?)?(?:10\^?\d{1,2}\/[lL]|[a-zµμ]{0,4}g\/[dmcµμ]?l|[mµμnp]?mol\/l|[mµμ]?[ik]?u\/m?l|[mµμ]?iu\/m?l|tys\.?\/[µμu]l|mln\.?\/[µμu]l|tsd\.?\/[µμu]l|mio\.?\/[µμu]l|g\/l|\/[µμu]l|\/nl|\/pl|gpt\/l|tpt\/l|fl|pg|sek|s|mm\/h|mm\/godz|%|‰|inr|ratio|titre|titer|miano|mmhg|mosm\/kg|e\/l|u\/l|ml\/min(?:\/1[.,]73\s?m2)?|ng\/ml|pg\/ml|µg\/l|ug\/l|mg\/l|kU\/l)\*?$/i;

export function isUnitLike(raw: string): boolean {
  const s = raw.replace(/^[[(]+|[)\],;]+$/g, '');
  return UNIT_RE.test(s);
}

/** Lines whose text is a label ("Order Date :", "Data pobrania:") rather than a result. */
export function isLabelToken(raw: string): boolean {
  return raw === ':' || /[\p{L}.]:$/u.test(raw);
}

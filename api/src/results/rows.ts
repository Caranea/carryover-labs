import type { StoredPage } from '../documents/contract.js';
import type { DocumentLocale, Flag, Observation } from './contract.js';
import { linesOf, textOf, Tok, unionBox } from './layout.js';
import { collectionDateOnLine, explicitDate } from './locale.js';
import {
  isDateLike,
  isLabelToken,
  isQualitative,
  isTimeLike,
  isUnitLike,
  isValueToken,
  norm,
  parseFlag,
  parseNumber,
  parseRange,
} from './tokens.js';

/** Row names that only make sense with the heading above them. */
const GENERIC_NAMES = new Set(['wynik', 'result', 'ergebnis', 'wartosc', 'value', 'wert']);

const JUNK_RE = /^[|\\¦§_~`'"„”“‚‘’^°•·.,=]+$/u;

type ColumnKind = 'name' | 'value' | 'unit' | 'range' | 'min' | 'max' | 'flag' | 'date' | 'other';

interface Column {
  kind: ColumnKind;
  /** Left and right edge of the header words, in page pixels. */
  left: number;
  right: number;
}

/** Header words, normalised (lowercase, no diacritics, no punctuation). */
const HEADER: Record<Exclude<ColumnKind, 'other'>, string[]> = {
  name: ['badanie', 'badania', 'nazwa', 'oznaczenie', 'parametr', 'test', 'tests', 'observation', 'investigation', 'analyte', 'untersuchung', 'parameter', 'analyse', 'bezeichnung', 'examination'],
  value: ['wynik', 'wyniki', 'result', 'results', 'value', 'ergebnis', 'wert', 'messwert'],
  unit: ['jedn', 'jednostka', 'jednostki', 'unit', 'units', 'einheit', 'einh'],
  range: ['zakres', 'norma', 'normy', 'referencyjny', 'referencyjne', 'ref', 'reference', 'range', 'referenzbereich', 'referenzwert', 'normbereich', 'normalwerte', 'normwert', 'wertebereich'],
  date: ['date', 'data', 'datum'],
  min: ['min'],
  max: ['max'],
  flag: ['flaga', 'flag', 'flags', 'kennzeichen', 'liw'],
};
const OTHER_HEADER = ['status', 'uwagi', 'comment', 'kommentar', 'metoda', 'method', 'methode'];

/** Header words run together by OCR. */
const JOINED: Record<string, ColumnKind> = { resultflag: 'flag', refrange: 'range', referencerange: 'range', normalrange: 'range' };

function headerKind(t: Tok, next?: Tok): ColumnKind | null {
  const n = norm(t.text);
  // "Result Flag" is the flag column, not the value column.
  if (/^res[uv]lt$/.test(n) && next && norm(next.text) === 'flag') return 'flag';
  // OCR slips: "Valve" for "Value", "JUnits" for "Units", "]ResultFlag".
  const candidates = n.length > 4 ? [n, n.slice(1)] : [n];
  for (const c of candidates) {
    if (JOINED[c]) return JOINED[c];
    for (const [kind, words] of Object.entries(HEADER)) {
      if (words.includes(c)) return kind as ColumnKind;
      if (c.length >= 5 && words.some((w) => w.length >= 5 && oneEditApart(c, w))) return kind as ColumnKind;
    }
    if (OTHER_HEADER.includes(c)) return 'other';
  }
  return null;
}

function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** A table header: at least three header words of at least three kinds, including a value or min/max column. */
function detectHeader(line: Tok[]): Column[] | null {
  if (!line.every((t) => t.box)) return null;
  const marked = line.map((t, k) => ({ t, kind: headerKind(t, line[k + 1]) }));
  const kinds = new Set(marked.map((m) => m.kind).filter(Boolean));
  const hasValue = kinds.has('value') || (kinds.has('min') && kinds.has('max'));
  if (!hasValue || kinds.size < 3) return null;
  // Too much other text means a sentence that happens to mention "wynik" and "zakres".
  const unknown = marked.filter((m) => !m.kind && /\p{L}{3,}/u.test(m.t.text)).length;
  if (unknown > marked.length / 2) return null;

  const columns: Column[] = [];
  for (const { t, kind } of marked) {
    const [x, , w] = t.box!;
    const last = columns[columns.length - 1];
    // Words without a kind ("referencyjny", "**", "Range") extend the column before them.
    if (!kind || (last && last.kind === kind && x - last.right < t.box![3] * 3)) {
      if (last) last.right = Math.max(last.right, x + w);
      continue;
    }
    columns.push({ kind, left: x, right: x + w });
  }
  if (columns[0]?.kind !== 'name') columns.unshift({ kind: 'name', left: 0, right: 0 });
  return columns;
}

/** Which column a word belongs to: by position against the header words. */
function columnOf(t: Tok, columns: Column[], charW: number): number {
  const [x, , w] = t.box!;
  const centre = x + w / 2;
  for (let c = columns.length - 1; c > 0; c--) {
    const col = columns[c];
    const prev = columns[c - 1];
    // The name column is wide and left-aligned: it ends a little before the next header.
    const start = prev.kind === 'name' ? col.left - charW * 2.5 : (prev.right + col.left) / 2;
    if (centre >= start) return c;
  }
  return 0;
}

interface RawRow {
  name: Tok[];
  value: Tok[];
  unit: Tok[];
  range: Tok[];
  min: Tok[];
  max: Tok[];
  flag: Tok[];
  date: Tok[];
}

function emptyRow(): RawRow {
  return { name: [], value: [], unit: [], range: [], min: [], max: [], flag: [], date: [] };
}

/** Extract every result row on a page. */
export function extractPage(
  documentId: string,
  pageIndex: number,
  page: StoredPage,
  locale: DocumentLocale,
): Observation[] {
  // Stray marks from photos and table rules ("|", "\\", "§") carry no meaning.
  const lines = linesOf(page)
    .map((l) => l.filter((t) => !JUNK_RE.test(t.text)))
    .filter((l) => l.length);
  const out: Observation[] = [];
  let columns: Column[] | null = null;
  let charW = 8;
  let tableSeen = false;
  let heading: Tok[] | null = null;
  let currentLocale = { ...locale };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const collection = collectionDateOnLine(line, locale, lines[li + 1]);
    if (collection.labelled) {
      currentLocale = { ...locale, collectionDate: collection.date, collectionDateSource: collection.date ? 'label' : null };
      continue;
    }
    const header = detectHeader(line);
    if (header) {
      columns = header;
      tableSeen = true;
      charW = Math.max(4, median(line.map((t) => t.box![3])) * 0.55);
      continue;
    }

    let row: RawRow | null = null;
    if (columns && line.every((t) => t.box)) {
      row = emptyRow();
      for (const t of line) {
        const kind = columns[columnOf(t, columns, charW)].kind;
        if (kind !== 'other') row[kind].push(t);
      }
    } else if (!tableSeen) {
      const found = inlineRow(line, lines[li + 1]);
      row = found?.row ?? null;
      if (found?.usedNext) li++;
    }
    if (!row) continue;

    // "P/c. p. receptorom TSH (TRAb)" on one line, "Wynik  2,06  IU/l" on the next.
    const generic = GENERIC_NAMES.has(norm(textOf(row.name)));
    if (generic && heading) row.name = [...heading, ...row.name];
    const obs = toObservation(row, documentId, pageIndex, currentLocale, columns !== null);
    if (obs) out.push(obs);
    // A name with no value is a heading for the rows below it.
    heading = !obs && !row.value.length && row.name.some((t) => /\p{L}{3,}/u.test(t.text)) ? row.name : null;
  }
  return out;
}

/**
 * Pages without a table header (for example cumulative reports): a line is a
 * result when it reads "name value [unit] [range] [flag]". The range and unit
 * may sit on the next line, as in "[3,9 - 10,2] [Gpt/l]".
 */
function inlineRow(line: Tok[], next?: Tok[]): { row: RawRow; usedNext: boolean } | null {
  const v = line.findIndex((t, k) => k > 0 && (isValueToken(t.text) || isQualitative(t.text)) && !startsRange(line, k));
  if (v < 1) return null;
  const name = line.slice(0, v);
  if (!looksLikeName(textOf(name))) return null;
  // Long names are sentences in comments ("… Diabetes mellitus >= 7,0 mmol/l").
  if (name.length > 6) return null;
  const row = emptyRow();
  row.name = name;
  row.value = [line[v]];
  for (const t of line.slice(v + 1)) {
    if (!row.unit.length && isUnitLike(t.text)) row.unit.push(t);
    else if (parseFlag(t.text) && /^(H|L|HH|LL|↑|↓)$/i.test(t.text)) row.flag.push(t);
    else row.range.push(t);
  }
  // Range and unit on the following line, with no name of its own: "[3,9 - 10,2] [Gpt/l]" or just "[g/dl]".
  let usedNext = false;
  const nextIsUnitOnly = next && next.length <= 2 && next.some((t) => isUnitLike(t.text));
  if (!row.unit.length && !row.range.length && next && (parseRange(textOf(next)) || nextIsUnitOnly)) {
    const words = next.filter((t) => /^[\p{L}]{3,}$/u.test(t.text.replace(/[[\]().,|]/g, '')) && !isUnitLike(t.text));
    if (!words.length) {
      usedNext = true;
      for (const t of next) {
        if (isUnitLike(t.text)) row.unit.push(t);
        else row.range.push(t);
      }
    }
  }
  // Comment sentences: "in children <2 years and patients with either partial …".
  if (row.range.filter((t) => /\p{L}{3,}/u.test(t.text)).length >= 4) return null;
  return { row, usedNext };
}

/** "80 - 99]" or "[3,9": the number opens or closes a printed range, it is not the result. */
function startsRange(line: Tok[], k: number): boolean {
  const t = line[k].text;
  if (/[[\]]/.test(t)) return true;
  return /^[-–—]$/.test(line[k + 1]?.text ?? '') && isValueToken(line[k + 2]?.text.replace(/[[\]()]/g, '') ?? '');
}

function toObservation(
  row: RawRow,
  documentId: string,
  pageIndex: number,
  locale: DocumentLocale,
  fromTable: boolean,
): Observation | null {
  // OCR noise before the name on photos: "€i Gliadin", "5 Immunoglobulin A".
  const noise = (t: string) => !/\p{L}/u.test(t) || (t.length <= 2 && /[^\p{L}.]/u.test(t));
  while (row.name.length > 1 && noise(row.name[0].text) && row.name.slice(1).some((t) => /\p{L}{2,}/u.test(t.text))) {
    row.name.shift();
  }
  // Name: words with letters, not a label ("Order Date :"), not a date line.
  const name = cleanName(row.name);
  if (!name || !looksLikeName(name)) return null;
  // "< 5,0] [mg/l": range and unit pieces from the line above are not a name.
  const words = row.name.filter((t) => !/[[\]]/.test(t.text) && !isUnitLike(t.text));
  if (!words.some((t) => looksLikeName(t.text.replace(/[(),.:;]/g, '')))) return null;
  // Label lines ("Order Date :", "Data pobrania:") are not results. "TSH (ICD-9: L69)" is.
  const last = row.name[row.name.length - 1]?.text ?? '';
  if (row.name.some((t) => t.text === ':') || isLabelToken(last)) return null;

  // Value: the first number (or qualitative word) in the value cells.
  const valueTok =
    row.value.find((t) => isValueToken(t.text) && !/[[\]]/.test(t.text)) ?? row.value.find((t) => isQualitative(t.text));
  if (!valueTok) return null;
  if (row.value.some((t) => isDateLike(t.text) || isTimeLike(t.text))) return null;
  const parsed = parseNumber(valueTok.text);
  // Comparator printed as a separate word: "< 4".
  const vIdx = row.value.indexOf(valueTok);
  const before = row.value[vIdx - 1]?.text;
  const comparator = parsed?.comparator ?? (before && /^(<|>|≤|≥|<=|>=)$/.test(before) ? (before.replace('<=', '≤').replace('>=', '≥') as '<' | '>' | '≤' | '≥') : null);

  // Flag: dedicated column, a word next to the value, or a letter stuck to the value.
  let flag: Flag | null = parsed?.flag ?? null;
  for (const t of [...row.flag, ...row.value.slice(vIdx + 1)]) flag ??= parseFlag(t.text);

  // Units pushed into the range cell by a skewed photo: "x | 10^9/L 4.5 - 13.0".
  while (row.range.length && /\//.test(row.range[0].text) && !parseRange(row.range[0].text)) row.unit.push(row.range.shift()!);

  // A lab mark printed after the range: "4,0-10,0 L".
  const lastRange = row.range[row.range.length - 1];
  if (!flag && lastRange && /^(H|L|HH|LL|↑|↓)$/.test(lastRange.text)) {
    flag = parseFlag(lastRange.text);
    row.flag.push(row.range.pop()!);
  }
  // A unit in brackets after the range: "[3,9 - 10,2] [Gpt/l]".
  if (!row.unit.length) {
    while (row.range.length > 1 && /^\[[^\d]*\p{L}[^\d]*\]?$/u.test(row.range[row.range.length - 1].text)) {
      row.unit.unshift(row.range.pop()!);
    }
  }

  // Without a header, insist on a unit or a range so stray numbers are not taken for results.
  const unitText = row.unit.map((t) => t.text).join(' ').trim() || null;
  let refText = row.range.map((t) => t.text).join(' ').trim() || null;
  let refLow: number | null = null;
  let refHigh: number | null = null;
  if (row.min.length || row.max.length) {
    refLow = parseNumber(row.min[0]?.text ?? '')?.value ?? null;
    refHigh = parseNumber(row.max[0]?.text ?? '')?.value ?? null;
    refText = [row.min.map((t) => t.text).join(' '), row.max.map((t) => t.text).join(' ')].filter(Boolean).join(' – ') || null;
  } else if (refText) {
    const r = parseRange(refText);
    refLow = r?.low ?? null;
    refHigh = r?.high ?? null;
  }
  if (!fromTable && !unitText && refLow === null && refHigh === null) return null;
  // Keep incomplete table rows so the records view can explain a missing unit.

  const explicitDates = new Set(row.date.filter((t) => isDateLike(t.text)).map((t) => explicitDate(t.text, locale)));
  const date = row.date.length ? (explicitDates.size === 1 ? [...explicitDates][0] : null) : locale.collectionDate;
  const used = [...row.date, ...row.name, ...row.value, ...row.unit, ...row.range, ...row.min, ...row.max, ...row.flag];
  return {
    id: `${documentId}:${pageIndex}:${row.name[0]?.line ?? valueTok.line}`,
    documentId,
    page: pageIndex,
    bbox: unionBox(used),
    words: used.map((t) => t.i).sort((a, b) => a - b),
    name,
    value: parsed ? parsed.value : null,
    valueText: [comparator && !parsed?.comparator ? comparator : '', valueTok.text].filter(Boolean).join(' '),
    comparator,
    unit: unitText ? unitText.replace(/^\[|\]$/g, '').trim() : null,
    refLow,
    refHigh,
    refText: refText ? refText.replace(/^\[|\]$/g, '').trim() : null,
    flag,
    date,
    dateSource: date ? (row.date.length ? 'label' : locale.collectionDateSource) : null,
  };
}

/** A test name has a word, or is a short code such as "C3", "K" or "B12". */
function looksLikeName(name: string): boolean {
  return /\p{L}{2,}/u.test(name) || /^\p{Lu}{1,2}\d{0,2}$/u.test(name.trim());
}

function cleanName(toks: Tok[]): string {
  return textOf(toks)
    .replace(/^[|[\]{}()*•·.,;:\s-]+/, '')
    .replace(/[|[\]{}\s,;:-]+$/, '')
    .replace(/\s+\d$/, '') // footnote marker after the name: "TSH (ICD-9: L69) 1"
    .trim();
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 10;
}

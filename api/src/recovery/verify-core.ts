import type { SavedDocument, StoredPage, StoredWord, Tuple4 } from '../documents/contract.js';
import type { Observation } from '../results/contract.js';
import { detectLocale, explicitDate } from '../results/locale.js';
import { isQualitative, isUnitLike, norm, parseNumber, parseRange } from '../results/tokens.js';
import { parseUnit } from '../records/units.js';
import type { RecoveryEvidence } from './contract.js';

const FIELDS = ['name', 'value', 'unit', 'date', 'reference'] as const;
const MAX_FIELD_WORDS = { name: 16, value: 4, unit: 8, date: 4, reference: 12 };

export type VerificationFailure = 'structure' | 'hidden-or-missing-word' | 'overlapping-fields' | 'distant-evidence' | 'unsupported-value' | 'unsupported-unit' | 'unsupported-name' | 'unrelated-date' | 'already-read';
export type VerifiedEvidence = { ok: true; observation: Observation; dateText: string | null; issues: string[] } | { ok: false; reason: VerificationFailure };

/** Rebuild only from visible source words. The model supplies no reading, unit or date text. */
export function verifyEvidence(doc: SavedDocument, pageIndex: number, evidence: RecoveryEvidence, existing: Observation[] = [], options: { sourceExtraction?: boolean } = {}): VerifiedEvidence {
  const fail = (reason: VerificationFailure): VerifiedEvidence => ({ ok: false, reason });
  const page = doc.pages[pageIndex];
  if (!Number.isInteger(pageIndex) || !page || page.index !== pageIndex || !evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return fail('structure');
  if (Object.keys(evidence).length !== FIELDS.length || Object.keys(evidence).some((key) => !FIELDS.includes(key as typeof FIELDS[number]))) return fail('structure');
  for (const field of FIELDS) {
    const indices = evidence[field];
    if (!Array.isArray(indices) || indices.length > MAX_FIELD_WORDS[field] || ((field === 'name' || field === 'value') && !indices.length)) return fail('structure');
    // A field must retain source order and cannot skip hidden or intervening words.
    if (new Set(indices).size !== indices.length || indices.some((index, i) => !Number.isInteger(index) || index < 0 || index >= page.words.length
      || (!options.sourceExtraction && i > 0 && index !== indices[i - 1] + 1))) return fail('structure');
    if (indices.some((index) => !visibleWord(page, page.words[index]))) return fail('hidden-or-missing-word');
  }
  // Scanned reports often fuse a unit and range into one token, e.g.
  // "mg/L(0-6)". Separate only those unambiguous printed substrings.
  const combined = options.sourceExtraction && evidence.unit.length === 1
    ? /^(.+?)\s*\(([^()]+)\)$/.exec(page.words[evidence.unit[0]].t!) : null;
  const splitUnitRange = combined && parseUnit(combined[1]) && parseRange(combined[2]) ? combined : null;
  const sharedUnitRange = splitUnitRange && evidence.reference.length === 1 && evidence.reference[0] === evidence.unit[0];
  const all = FIELDS.flatMap((field) => sharedUnitRange && field === 'reference' ? [] : evidence[field]);
  if (new Set(all).size !== all.length) return fail('overlapping-fields');
  const rowIndices = [...evidence.name, ...evidence.value, ...evidence.unit, ...evidence.reference];
  const rowWords = rowIndices.map((i) => page.words[i]);
  const anchor = evidence.value.map((i) => page.words[i]);
  if (!nearby(rowWords, anchor) || (!options.sourceExtraction && evidence.name[0] >= evidence.value[0])) return fail('distant-evidence');
  // A percentage and count can share one printed name. During primary
  // extraction, the value evidence identifies a reading, not its shared label.
  if (existing.some((o) => o.page === pageIndex && (options.sourceExtraction
    ? (o.sourceEvidence?.value ?? o.words).some(i => evidence.value.includes(i))
    : o.words.some(i => rowIndices.includes(i))))) return fail('already-read');

  const text = (field: keyof RecoveryEvidence) => evidence[field].map((i) => page.words[i].t!).join(' ');
  const name = text('name'), valueText = text('value');
  const unit = splitUnitRange ? splitUnitRange[1] : text('unit') || null;
  const refText = splitUnitRange && (sharedUnitRange || !evidence.reference.length) ? splitUnitRange[2] : text('reference') || null;
  if (name.length > 200 || !/\p{L}/u.test(name) || /^(?:patient|pacjent|name|imie|nazwisko|geburtsdatum|birth|address|age|data|date|datum|order|reference|range|result|wynik|ergebnis)(?:\b|:)/i.test(norm(name))) return fail('unsupported-name');
  const parsed = parseNumber(valueText);
  const qualitative = isQualitative(valueText) || /^(?:not detected|not reactive|nie wykryto|nicht nachweisbar|\d{1,6}:\d{1,6})$/i.test(valueText);
  if (valueText.length > 100 || (!parsed && !qualitative) || isRangeEndpoint(page, evidence.value)) return fail('unsupported-value');
  // Primary extraction retains literal OCR units, including garbled ones. The
  // server record builder keeps unverified units out of charts for correction.
  if (unit && (unit.length > 60 || (!options.sourceExtraction && !parseUnit(unit) && !isUnitLike(unit) && !/^[\p{L}µμ\d*^%.]+\/[\p{L}µμ\d*^%.]+$/u.test(unit)))) return fail('unsupported-unit');
  if (refText && refText.length > 200) return fail('structure');

  const dateText = text('date') || null;
  const dateWords = evidence.date.map((i) => page.words[i]);
  if (dateWords.length && !rowDate(page, dateWords, anchor) && !collectionDate(page, evidence.date)) return fail('unrelated-date');
  const calendarText = options.sourceExtraction ? dateText?.replace(/\s+\d{1,2}:\d{2}(?::\d{2})?$/, '') : dateText;
  const date = calendarText ? explicitDate(calendarText, detectLocale([page])) : null;
  const reference = refText ? parseRange(refText) : null;
  const issues: string[] = [];
  if (!date) issues.push(dateText ? 'The printed date is ambiguous. Confirm the collection date after adding this reading.' : 'No collection date was selected. Add it after checking the source.');
  if (parsed && !unit) issues.push('The unit is missing. Add the printed unit before comparing this reading.');
  if (unit && !parseUnit(unit)) issues.push('The printed unit needs checking before this reading can be compared.');
  return {
    ok: true,
    dateText,
    issues,
    observation: {
      id: '', documentId: doc.id, page: pageIndex, bbox: unionBox(rowWords), words: [...all].sort((a, b) => a - b),
      name, value: parsed?.value ?? null, valueText, comparator: parsed?.comparator ?? null, unit,
      refLow: reference?.low ?? null, refHigh: reference?.high ?? null, refText, flag: parsed?.flag ?? null,
      date, dateSource: date ? 'label' : null,
    },
  };
}

export function visibleWord(page: StoredPage, word: StoredWord | undefined): boolean {
  if (!word || word.h || typeof word.t !== 'string' || !word.t.trim() || /[\u0000-\u001f\u007f]/.test(word.t)) return false;
  if (!word.b) return !page.hasImage;
  const [x, y, w, h] = word.b;
  if (!word.b.every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > page.width || y + h > page.height) return false;
  return !page.regions.some(([rx, ry, rw, rh]) => x < rx + rw && x + w > rx && y < ry + rh && y + h > ry);
}

function nearby(words: StoredWord[], anchor: StoredWord[]): boolean {
  if (words.every((word) => word.b) && anchor.every((word) => word.b)) {
    const heights = words.map((word) => word.b![3]).sort((a, b) => a - b);
    const tolerance = Math.max(18, heights[Math.floor(heights.length / 2)] * 2.2);
    const y = anchor.reduce((sum, word) => sum + word.b![1] + word.b![3] / 2, 0) / anchor.length;
    return words.every((word) => Math.abs(word.b![1] + word.b![3] / 2 - y) <= tolerance);
  }
  return anchor.every((word) => word.l === anchor[0].l) && words.every((word) => Math.abs(word.l - anchor[0].l) <= 1);
}

function rowDate(page: StoredPage, dates: StoredWord[], anchor: StoredWord[]): boolean {
  if (!dates.every((word) => word.l === anchor[0].l)) return false;
  // A birth/receipt date on a metadata line cannot become a result date.
  const line = page.words.filter((word) => word.l === dates[0].l && !word.h && word.t).map((word) => word.t).join(' ');
  return !/birth|geburt|urodzen|received|eingang|registration|rejestr/i.test(line) && nearby(dates, anchor);
}

function collectionDate(page: StoredPage, indices: number[]): boolean {
  const selected = indices.map((i) => page.words[i]);
  if (!selected.every((word) => word.l === selected[0].l)) return false;
  const first = indices[0];
  return page.words.some((word, index) => index < first && first - index <= 6 && word.l === selected[0].l && visibleWord(page, word) && /pobran|pobrano|pobranie|entnahme|abnahme|probenahme|collected|collection/.test(norm(word.t!)));
}

function isRangeEndpoint(page: StoredPage, indices: number[]): boolean {
  const first = indices[0], last = indices[indices.length - 1];
  const before = page.words[first - 1], after = page.words[last + 1];
  const dash = (word: StoredWord | undefined) => word && word.l === page.words[first].l && /^[-–—]$/.test(word.t ?? '');
  return !!(dash(before) || dash(after));
}

function unionBox(words: StoredWord[]): Tuple4 | null {
  if (!words.every((word) => word.b)) return null;
  const x = Math.min(...words.map((word) => word.b![0])), y = Math.min(...words.map((word) => word.b![1]));
  const right = Math.max(...words.map((word) => word.b![0] + word.b![2])), bottom = Math.max(...words.map((word) => word.b![1] + word.b![3]));
  return [x, y, right - x, bottom - y];
}

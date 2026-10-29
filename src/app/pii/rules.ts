import { PiiKind, WorkingWord } from '../core/models';
import {
  digitsOnly,
  isDateToken,
  isNumericValue,
  isRangeToken,
  isUnitToken,
  isValidPesel,
  levenshtein,
  normalizeToken,
} from './text-utils';

export interface Hit {
  kind: PiiKind;
  source: 'rule';
}

export interface RuleOptions {
  strict: boolean;
}

type LineWord = WorkingWord & { text: string };

interface Label {
  tokens: string[];
  kind: PiiKind;
  /** Max words captured after the label. */
  take: number;
}

/**
 * Field labels after which the value is personal data. Tokens are normalised
 * (lowercase, no diacritics, no trailing colon). Polish, German and English.
 */
const LABELS: Label[] = [
  ...people([
    'pacjent', 'pacjentka', 'imie i nazwisko', 'nazwisko i imie', 'nazwisko', 'imie', 'imiona',
    'lekarz', 'lekarz zlecajacy', 'lekarz kierujacy', 'zlecajacy', 'kierujacy', 'wykonal', 'wykonala',
    'autoryzowal', 'autoryzowala', 'zatwierdzil', 'zatwierdzila', 'diagnosta', 'technik', 'opiekun',
    'patient', 'patient name', 'name', 'surname', 'given name', 'doctor', 'requested by',
    'referring doctor', 'referred by', 'collected by', 'authorised by', 'authorized by', 'reported by',
    'vorname', 'nachname', 'patientenname', 'name des patienten', 'versicherter', 'arzt', 'arztin', 'einsender',
    'validiert von', 'befundet von', 'copy to', 'addressee', 'attention',
    'freigegeben von', 'unterschrift',
  ]),
  ...fields('address', 8, ['adres', 'adres zamieszkania', 'address', 'anschrift', 'adresse', 'wohnort']),
  ...fields('national-id', 2, ['pesel']),
  ...fields('id-number', 3, [
    'nr karty', 'nr pacjenta', 'id pacjenta', 'numer karty', 'nr ubezpieczenia', 'nr dokumentu',
    'medicare', 'medicare no', 'mrn', 'ur no', 'urn', 'patient id', 'lab no', 'lab number',
    'versichertennummer', 'versicherten-nr', 'patientennummer', 'pat.-nr', 'fallnummer',
  ]),
  ...fields('birth-date', 2, [
    'data urodzenia', 'ur', 'urodzony', 'urodzona', 'dob', 'd.o.b', 'date of birth', 'birth date', 'birthdate',
    'geburtsdatum', 'geb', 'geboren am',
  ]),
  ...fields('age', 2, ['wiek', 'age', 'alter']),
  ...fields('contact', 4, ['tel', 'telefon', 'tel. kom', 'phone', 'telephone', 'mobile', 'e-mail', 'email', 'fax']),
];

function people(names: string[]): Label[] {
  return fields('person', 5, names);
}

function fields(kind: PiiKind, take: number, names: string[]): Label[] {
  return names.map((n) => ({ tokens: n.split(' '), kind, take }));
}

/** First words of field labels that span two words ("Data pobrania:", "Nr karty:"). */
const LABEL_STARTERS = new Set([
  'data', 'datum', 'date', 'nr', 'numer', 'kod', 'order', 'specimen', 'sample', 'lab', 'probe', 'adres', 'address',
  'telefon', 'tel', 'plec', 'sex', 'wiek', 'age', 'oddzial', 'lekarz', 'kontrahent', 'material', 'godz', 'time', 'uhrzeit',
  'material', 'collected', 'requested', 'reported', 'auftrag', 'eingang', 'befund', 'your', 'our', 'patient', 'pacjent',
]);

/** Words that introduce a street name. */
const STREET_CUES = new Set([
  'ul', 'ulica', 'al', 'aleja', 'aleje', 'os', 'osiedle', 'pl', 'plac', 'str', 'strasse', 'weg',
  'street', 'road', 'rd', 'avenue', 'ave', 'lane', 'ln', 'court', 'ct',
]);

/** Titles before a person's name: "dr n. med. Anna Nowak", "Prof. Dr. Weber". */
const TITLES = new Set([
  'dr', 'lek', 'prof', 'mgr', 'doc', 'inz', 'hab', 'med', 'n', 'dent', 'wet', 'dipl', 'mudr',
  'mr', 'mrs', 'ms', 'miss', 'herr', 'frau', 'pan', 'pani',
]);

const KVNR_RE = /^[A-Z]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PL_POSTAL_RE = /^\d{2}-\d{3}$/;
const PHONE_RE =
  /(?:\+\d{2,3}[\s-]?)?(?:\(?\d{2,3}\)?[\s-]?)?\d{3}[\s-]?\d{3}[\s-]?\d{3}|(?:\+\d{2,3}[\s-]?)?\d{2}[\s-]\d{3}[\s-]\d{2}[\s-]\d{2}|\(0?\d{1,2}\)\s?\d{4}[\s-]?\d{4}/g;

/**
 * Deterministic detectors. Recall-first: anything personal-looking outside a
 * result row is hidden; result rows (value, unit, range) are protected.
 */
export function detectWithRules(words: WorkingWord[], options: RuleOptions): Map<number, Hit> {
  const hits = new Map<number, Hit>();
  const add = (w: WorkingWord, kind: PiiKind) => {
    if (!hits.has(w.id)) hits.set(w.id, { kind, source: 'rule' });
  };

  const lines = groupLines(words);
  lines.forEach((line, lineIndex) => {
    const result = isResultLine(line);
    const norm = line.map((w) => normalizeToken(w.text));

    line.forEach((w, i) => {
      const raw = w.text;
      const digits = digitsOnly(raw);

      if (digits.length === 11 && /^[\d\s-]+$/.test(raw) && isValidPesel(digits)) add(w, 'national-id');
      if (EMAIL_RE.test(raw)) add(w, 'contact');
      if (KVNR_RE.test(raw)) add(w, 'id-number');

      // Long digit strings: insurance, order, sample and phone numbers.
      const longId = result ? digits.length >= 9 : digits.length >= 7;
      if (longId && !isDateToken(raw) && /^[\d\s\-./#]+$/.test(raw.replace(/^[A-Za-z]{1,3}[:#-]?/, ''))) {
        add(w, 'id-number');
      }
    });

    if (!result) {
      // Polish postal code and the town after it.
      line.forEach((w, i) => {
        if (PL_POSTAL_RE.test(w.text)) {
          add(w, 'address');
          for (let j = i + 1; j < Math.min(line.length, i + 3); j++) {
            if (/^\p{Lu}/u.test(line[j].text)) add(line[j], 'address');
            else break;
          }
        }
      });

      // Street names: "ul. Długa 12/3", "Hauptstr. 5", "12 Smith St".
      line.forEach((w, i) => {
        const n = norm[i];
        if (STREET_CUES.has(n) && i + 1 < line.length && /^[\p{Lu}\d]/u.test(line[i + 1].text)) {
          for (let j = i + 1; j < Math.min(line.length, i + 5); j++) {
            if (line[j].text.endsWith(':')) break;
            add(line[j], 'address');
          }
        }
        if (/(?:str|strasse|straße)\.?$/i.test(w.text) && w.text.length > 4) {
          add(w, 'address');
          if (line[i + 1] && /^\d+[a-z]?$/i.test(line[i + 1].text)) add(line[i + 1], 'address');
        }
      });

      // Phone numbers split over several words.
      matchAcrossLine(line, PHONE_RE).forEach((w) => add(w, 'contact'));
    }

    // "P.KOWALSKI, 12345": an initial and surname, then often a licence number.
    line.forEach((w, i) => {
      // Also "P.KOWALSKI,12345;" printed as one word.
      if (!/^\p{Lu}\.\s?\p{Lu}[\p{Lu}'-]{2,}(?:,\d{0,7};?)?$/u.test(w.text)) return;
      add(w, 'person');
      if (/^\d{4,7},?$/.test(line[i + 1]?.text ?? '')) add(line[i + 1], 'id-number');
    });

    // "SMITH,DR." and "SMITH, DR." (surname first, as on Australian reports).
    line.forEach((w, i) => {
      if (/^\p{Lu}[\p{L}'-]+,(?:DR|MR|MRS|MS|PROF)\.?$/iu.test(w.text)) add(w, 'person');
      if (/^\p{Lu}[\p{L}'-]+,$/u.test(w.text) && TITLES.has(norm[i + 1] ?? '')) add(w, 'person');
    });

    // Titles: the capitalised words after "dr", "lek.", "Prof." are a name.
    line.forEach((w, i) => {
      if (!TITLES.has(norm[i]) || (i > 0 && TITLES.has(norm[i - 1]))) return;
      let j = i + 1;
      while (j < line.length && TITLES.has(norm[j])) j++;
      let taken = 0;
      for (; j < line.length && taken < 3; j++, taken++) {
        if (!/^\p{Lu}[\p{L}'-]*[,.]?$/u.test(line[j].text)) break;
        add(line[j], 'person');
      }
    });

    // Labelled fields: hide the value after "Pacjent:", "Geburtsdatum:" etc.
    const labels = findLabels(norm);
    const labelStarts = new Set(labels.map((l) => l.start));
    labels.forEach(({ start, label }, k) => {
      const valueStart = start + label.tokens.length;
      let taken = 0;
      const labelEnd = line[valueStart - 1];
      // A column header ("Badanie  Materiał  Autoryzował  Laboratorium"): no colon and the
      // next word far away. The names are in the rows below, not beside it.
      const headerWords = line.filter((w) => NOT_NAMES.has(normalizeToken(w.text))).length;
      const isColumnHeader =
        label.kind === 'person' &&
        !labelEnd.text.endsWith(':') &&
        !!line[valueStart] &&
        gap(labelEnd, line[valueStart]) > 1.5 &&
        (NOT_NAMES.has(normalizeToken(line[valueStart].text)) || headerWords >= 2);
      if (isColumnHeader) {
        hideNamesInColumn(line, lines.slice(lineIndex + 1, lineIndex + 9), start, valueStart - 1, (w) => add(w, 'person'));
        return;
      }
      for (let j = valueStart; j < line.length && taken < label.take; j++) {
        const word = line[j];
        if (labelStarts.has(j)) break; // the next label right after this one
        if (j > valueStart && word.text.endsWith(':')) break; // next field
        // Two-word next field ("Data pobrania:"): stop only if this word starts a label,
        // so "DOE JANE PESEL:" still hides the first name.
        if (line[j + 1]?.text.endsWith(':') && LABEL_STARTERS.has(norm[j])) break;
        if (label.kind === 'person' && /^\p{Ll}/u.test(word.text) && !/^(von|van|de|der|du|da)$/.test(word.text)) break;
        if (j > valueStart && word.box && line[j - 1].box && gap(line[j - 1], word) > 3) break; // next column
        if (label.kind !== 'birth-date' && isDateToken(word.text)) break; // e.g. exam date
        if (label.kind === 'person' && isNumericValue(word.text)) break;
        if (/^[:\-–]$/.test(word.text)) continue;
        add(word, label.kind);
        taken++;
      }
      // "Nazwisko i imię:" with the name printed on the line below.
      if (taken === 0 && label.kind === 'person' && valueStart >= line.length && !labelEnd.text.endsWith(':') && start > 0) {
        hideNamesInColumn(line, lines.slice(lineIndex + 1, lineIndex + 9), start, valueStart - 1, (w) => add(w, 'person'));
      } else if (taken === 0 && label.kind === 'person') {
        hideNameBelow(line, lines[lineIndex + 1], labels, k, (w) => add(w, 'person'));
      }
    });
  });

  if (options.strict) expandAroundPeople(words, hits);
  return hits;
}

/** Words that start a table, never a name: stops a label from taking the header below it. */
const NOT_NAMES = new Set([
  'badanie', 'badania', 'wynik', 'jedn', 'jednostka', 'zakres', 'norma', 'material', 'uwagi',
  'test', 'tests', 'result', 'results', 'value', 'units', 'unit', 'range', 'observation', 'comment',
  'untersuchung', 'ergebnis', 'einheit', 'referenz', 'referenzbereich', 'befund', 'bemerkung',
  'material', 'daty', 'laboratorium', 'diagnostyka', 'medyczne', 'laboratory', 'pathology', 'labor', 'szpital', 'hospital', 'klinikum', 'krew', 'surowica',
]);

/**
 * A person label at the end of its line ("Nazwisko i imię:", or "Wykonał: … Autoryzował:")
 * names the person on the next line, in the same column. Only short lines of
 * capitalised words are taken, so a table header below a label stays visible.
 */
function hideNameBelow(
  line: LineWord[],
  below: LineWord[] | undefined,
  labels: { start: number; label: Label }[],
  k: number,
  hide: (w: LineWord) => void,
): void {
  if (!below || below.length > 8 || isResultLine(below)) return;
  const edge = (i: number) => line[i]?.box;
  const startOf = (n: number) => edge(labels[n].start)?.x ?? 0;
  const endOf = (n: number) => {
    const last = edge(labels[n].start + labels[n].label.tokens.length - 1);
    return last ? last.x + last.w : 0;
  };
  const left = k > 0 ? (endOf(k - 1) + startOf(k)) / 2 : -Infinity;
  const right = k + 1 < labels.length ? (endOf(k) + startOf(k + 1)) / 2 : Infinity;
  let taken = 0;
  for (const w of below) {
    const x = w.box?.x ?? 0;
    if (x < left || x >= right) continue;
    if (w.text.endsWith(':') || NOT_NAMES.has(normalizeToken(w.text))) return;
    if (!/^\p{Lu}[\p{L}'-]*[,.]?$/u.test(w.text)) break;
    hide(w);
    if (++taken >= 5) break;
  }
}

/**
 * A person column header ("Autoryzował" above a table): hide name-shaped words
 * in that column on the following lines ("P.KOWALSKI,", "Anna Nowak").
 */
function hideNamesInColumn(line: LineWord[], below: LineWord[][], first: number, last: number, hide: (w: LineWord) => void): void {
  const a = line[first].box;
  const b = line[last].box;
  if (!a || !b) return;
  const prev = line[first - 1]?.box;
  const next = line[last + 1]?.box;
  const left = prev ? (prev.x + prev.w + a.x) / 2 : a.x - a.h * 2;
  const right = next ? (b.x + b.w + next.x) / 2 : Infinity;
  for (const row of below) {
    const inColumn = row.filter((w) => w.box && w.box.x >= left && w.box.x < right);
    if (inColumn.some((w) => w.text.endsWith(':') && normalizeToken(w.text).length > 3)) return; // a new section
    let taken = 0;
    for (const w of inColumn) {
      if (!/^(?:\p{Lu}\.\s?)*\p{Lu}[\p{L}'-]+[,.]?$/u.test(w.text) || NOT_NAMES.has(normalizeToken(w.text))) break;
      hide(w);
      if (++taken >= 3) break;
    }
  }
}

/** A result row: has a unit, or a range next to a value, and no address cue. */
export function isResultLine(line: { text: string | null }[]): boolean {
  const texts = line.map((w) => w.text ?? '');
  if (texts.some(isUnitToken)) return true;
  const hasRange = texts.some(isRangeToken) || texts.some((t, i) => t === '-' && isNumericValue(texts[i - 1] ?? '') && isNumericValue(texts[i + 1] ?? ''));
  const hasValue = texts.some(isNumericValue);
  const hasCue = texts.some((t) => STREET_CUES.has(normalizeToken(t)) || /^\d{2}-\d{3}$/.test(t));
  return hasRange && hasValue && !hasCue;
}

/** Tokens that must not be hidden by the model: values, units and ranges in result rows. */
export function isProtectedResultToken(text: string, lineIsResult: boolean): boolean {
  if (!lineIsResult) return false;
  return isNumericValue(text) || isUnitToken(text) || isRangeToken(text) || /^[-–<>=]$/.test(text);
}

export function groupLines(words: WorkingWord[]): LineWord[][] {
  const byLine = new Map<number, LineWord[]>();
  for (const w of words) {
    if (w.text === null) continue;
    const list = byLine.get(w.line) ?? [];
    list.push(w as LineWord);
    byLine.set(w.line, list);
  }
  return [...byLine.entries()].sort((a, b) => a[0] - b[0]).map(([, l]) => l);
}

function findLabels(norm: string[]): { start: number; label: Label }[] {
  const found: { start: number; label: Label }[] = [];
  for (let i = 0; i < norm.length; i++) {
    let best: Label | null = null;
    for (const label of LABELS) {
      if (label.tokens.every((t, k) => norm[i + k] === t)) {
        if (!best || label.tokens.length > best.tokens.length) best = label;
      }
    }
    if (best) {
      found.push({ start: i, label: best });
      i += best.tokens.length - 1;
    }
  }
  return found;
}

/** Horizontal gap between two words, in multiples of the left word's height. */
function gap(a: WorkingWord, b: WorkingWord): number {
  if (!a.box || !b.box) return 0;
  return (b.box.x - (a.box.x + a.box.w)) / Math.max(1, a.box.h);
}

function matchAcrossLine(line: LineWord[], re: RegExp): LineWord[] {
  let text = '';
  const spans: { start: number; end: number; word: LineWord }[] = [];
  for (const w of line) {
    if (text) text += ' ';
    spans.push({ start: text.length, end: text.length + w.text.length, word: w });
    text += w.text;
  }
  const out: LineWord[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const s = m.index;
    const e = s + m[0].length;
    for (const span of spans) if (span.start < e && s < span.end) out.push(span.word);
  }
  return out;
}

/** Strict mode: capitalised words right next to a hidden name are probably part of it. */
function expandAroundPeople(words: WorkingWord[], hits: Map<number, Hit>): void {
  for (const line of groupLines(words)) {
    line.forEach((w, i) => {
      if (hits.get(w.id)?.kind !== 'person') return;
      for (const n of [line[i - 1], line[i + 1]]) {
        if (n && !hits.has(n.id) && /^\p{Lu}[\p{Ll}'-]{2,}[,.]?$/u.test(n.text)) {
          hits.set(n.id, { kind: 'person', source: 'rule' });
        }
      }
    });
  }
}

/** File-name words that say what the file is, not whose it is. */
const GENERIC_FILE_WORDS = new Set([
  'wyniki', 'wynik', 'badanie', 'badania', 'morfologia', 'krew', 'skan', 'scan', 'scans', 'zdjecie', 'kopia', 'strona',
  'results', 'result', 'report', 'lab', 'labs', 'blood', 'test', 'tests', 'medical', 'photo', 'image', 'img', 'page',
  'copy', 'final', 'new', 'document', 'dokument', 'fixture', 'fixtures', 'pdf', 'jpg', 'jpeg', 'png', 'heic', 'docx',
  'befund', 'labor', 'bericht', 'kumulativbericht', 'blutbild', 'pathology', 'whatsapp', 'screenshot', 'download',
]);

/**
 * People name files after the patient ("Jane_Doe_2012.png", "kowalska morfologia.pdf").
 * Letter-only parts of the file name, other than words describing the file, are
 * hidden wherever the document prints them outside a result row.
 */
export function fileNameHints(fileName: string | undefined): Set<string> {
  const base = (fileName ?? '').replace(/\.[a-z0-9]{2,5}$/i, '');
  return new Set(
    base
      .split(/[^\p{L}]+/u)
      .map((p) => normalizeToken(p))
      .filter((p) => p.length >= 3 && !GENERIC_FILE_WORDS.has(p) && !NOT_NAMES.has(p)),
  );
}

/**
 * Default document title: the file name with personal parts replaced.
 * A part is removed when it is a long number, or when it matches a word that
 * detection hid in the document itself (the patient's name in
 * "Kowalska_morfologia.pdf" is almost always printed on the page too).
 */
export function sanitizeFileName(name: string, hiddenWords: Iterable<string> = []): string {
  const hidden = [...new Set([...hiddenWords].map(normalizeToken).filter((t) => t.length >= 3))];
  const base = name.replace(/\.[^.]+$/, '');
  const parts = base.split(/([_\-\s.]+)/);
  const cleaned = parts.map((p) => {
    if (/^[_\-\s.]+$/.test(p) || !p) return p;
    const digits = digitsOnly(p);
    if (digits.length >= 7 && !isDateToken(p)) return '▇▇▇';
    if (matchesAny(normalizeToken(p), hidden)) return '▇▇▇';
    return p;
  });
  const result = cleaned.join('').trim();
  return result || 'Document';
}

/** Same word, a small typo, or a declined form (Kowalska → Kowalskiej). */
function matchesAny(norm: string, candidates: string[]): boolean {
  if (norm.length < 3) return false;
  return candidates.some((c) => {
    if (norm === c) return true;
    if (c.length < 5 || norm.length < 5) return false;
    if (levenshtein(norm, c, 1) <= 1) return true;
    // Shared stem, different ending, in either direction.
    let common = 0;
    while (common < norm.length && common < c.length && norm[common] === c[common]) common++;
    return common >= Math.max(4, Math.min(norm.length, c.length) - 2) && Math.abs(norm.length - c.length) <= 3;
  });
}

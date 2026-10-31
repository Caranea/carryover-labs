import type { StoredPage } from './document.js';
import type { DocumentLocale, Language } from './results.js';
import { linesOf, type Tok } from './layout.js';
import { dateParts, isDateLike, norm, toIsoDate } from './tokens.js';

const LANGUAGE_WORDS: Record<Exclude<Language, 'unknown'>, string[]> = {
  pl: [
    'wynik',
    'badanie',
    'badania',
    'jedn',
    'jednostka',
    'norma',
    'zakres',
    'referencyjny',
    'pobrania',
    'pacjent',
    'krwi',
    'data',
  ],
  de: [
    'ergebnis',
    'einheit',
    'untersuchung',
    'befund',
    'referenzbereich',
    'auftrag',
    'auftragsdatum',
    'geschlecht',
    'geburtsdatum',
    'labor',
    'normbereich',
    'entnahme',
  ],
  en: [
    'result',
    'results',
    'units',
    'range',
    'collected',
    'specimen',
    'reference',
    'observation',
    'investigation',
    'requested',
    'reported',
    'patient',
    'final',
    'order',
  ],
};
const COLLECTION_LABEL = /pobran|pobrano|pobranie|entnahme|abnahme|probenahme|collected|collection/;

/** Infer formatting only. Receipt, registration and birth dates are never collection dates. */
export function detectLocale(pages: StoredPage[]): DocumentLocale {
  const lines = pages.flatMap(linesOf);
  const toks = lines.flat();
  const counts: Record<string, number> = { pl: 0, de: 0, en: 0 };
  for (const t of toks)
    for (const [lang, words] of Object.entries(LANGUAGE_WORDS))
      if (words.includes(norm(t.text))) counts[lang]++;
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const language = (best[1] >= 2 ? best[0] : 'unknown') as Language;
  let comma = 0,
    dot = 0,
    dayFirst = 0,
    monthFirst = 0;
  for (const t of toks) {
    if (!isDateLike(t.text)) {
      if (/^[<>]?\d{1,4},\d{1,3}\*?$/.test(t.text)) comma++;
      else if (/^[<>]?\d{1,4}\.\d{1,3}\*?$/.test(t.text)) dot++;
    }
    const p = dateParts(t.text);
    if (p?.shape === 'XXY') {
      if (p.a > 12) dayFirst++;
      if (p.b > 12) monthFirst++;
    }
  }
  const locale: DocumentLocale = {
    language,
    decimal: comma === dot ? (language === 'en' ? '.' : ',') : comma > dot ? ',' : '.',
    dateOrder: monthFirst && !dayFirst ? 'MDY' : 'DMY',
    ambiguousDateOrder: !!(dayFirst && monthFirst) || (!dayFirst && !monthFirst),
    collectionDate: null,
    collectionDateSource: null,
  };
  const dates = lines
    .map((line, i) => collectionDateOnLine(line, locale, lines[i + 1]))
    .filter((d) => d.labelled);
  const values = new Set(dates.map((d) => d.date));
  if (dates.length && values.size === 1 && !values.has(null)) {
    locale.collectionDate = dates[0].date;
    locale.collectionDateSource = 'label';
  }
  return locale;
}

export function explicitDate(text: string, locale: DocumentLocale): string | null {
  const p = dateParts(text);
  if (!p) return null;
  if (p.shape === 'XXY' && p.a <= 12 && p.b <= 12 && p.a !== p.b && locale.ambiguousDateOrder)
    return null;
  const order =
    p.shape === 'XXY' && p.a > 12
      ? 'DMY'
      : p.shape === 'XXY' && p.b > 12
        ? 'MDY'
        : locale.dateOrder;
  return toIsoDate(text, order);
}

export function collectionDateOnLine(
  line: Tok[],
  locale: DocumentLocale,
  next: Tok[] = [],
): { labelled: boolean; date: string | null } {
  const at = line.findIndex((t) => COLLECTION_LABEL.test(norm(t.text)));
  if (at < 0) return { labelled: false, date: null };
  const sameLine = line.slice(at + 1).filter((t) => isDateLike(t.text));
  const dateTokens = sameLine.length ? sameLine : next.filter((t) => isDateLike(t.text));
  const dates = new Set(dateTokens.map((t) => explicitDate(t.text, locale)));
  return { labelled: true, date: dates.size === 1 ? [...dates][0] : null };
}

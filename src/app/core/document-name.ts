import { normalizeToken as normaliseName } from '../pii/text-utils';
import { linesOf, textOf, type Tok } from '../../../api/src/results/layout';
import { detectLocale, explicitDate } from '../../../api/src/results/locale';
import type { DocumentLocale } from '../../../api/src/results/contract';
import type { StoredPage, WorkingPage } from './models';
import { toStoredPage } from '../redaction/burn';

const PERSONAL_LINE = /\b(?:birth\w*|born|dob|urodzen\w*|geburts\w*|pesel|ssn|patient|pacjent\w*|name|nazwisko|address|phone|telefon)\b/;
const COLLECTION = /\b(?:collected|collection|pobran\w*|entnahme|abnahme|probenahme)\b/;
const REPORT = /\b(?:reported|report date|date reported|issued|performed|test date|result date|data badania|data wykonania|data wydania|befunddatum|berichtsdatum)\b/;

function datesIn(tokens: Tok[], locale: DocumentLocale): string[] {
  const dates = new Set<string>();
  for (let i = 0; i < tokens.length; i++) for (let length = 1; length <= 3; length++) {
    const date = explicitDate(tokens.slice(i, i + length).map(t => t.text).join(' '), locale);
    if (date) dates.add(date);
  }
  return [...dates];
}

function reportDate(pages: WorkingPage[], stored: StoredPage[]): string | null {
  const locale = detectLocale(stored);
  const collected: (string | null)[] = [], reported: (string | null)[] = [];
  stored.forEach((page, pageIndex) => {
    const lines = linesOf(page);
    const personal = (line: Tok[]) => PERSONAL_LINE.test(normaliseName(pages[pageIndex].words
      .filter(w => w.line === line[0]?.line).map(w => w.text ?? '').join(' ')));
    lines.forEach((line, index) => {
      if (personal(line)) return;
      const text = normaliseName(textOf(line));
      const target = COLLECTION.test(text) ? collected : REPORT.test(text) ? reported : null;
      if (!target) return;
      let dates = datesIn(line, locale);
      const next = lines[index + 1];
      // Only borrow a standalone date line on this page, never a neighbouring DOB field.
      if (!dates.length && next && !personal(next) && next.length <= 4
        && next.every(t => /^[\d\s:./-]+$/.test(t.text))) dates = datesIn(next, locale);
      target.push(dates.length === 1 ? dates[0] : null);
    });
  });
  const values = new Set(collected.length ? collected : reported);
  return values.size === 1 && !values.has(null) ? [...values][0] : null;
}

export function documentReportDate(pages: WorkingPage[]): string | null {
  return reportDate(pages, pages.map(toStoredPage));
}

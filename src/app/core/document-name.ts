import type { Domain } from '../../../api/src/records/catalogue';
import { matchTest, normaliseName } from '../../../api/src/records/match';
import { linesOf, textOf, type Tok } from '../../../api/src/results/layout';
import { detectLocale, explicitDate } from '../../../api/src/results/locale';
import { extractPage } from '../../../api/src/results/rows';
import type { DocumentLocale } from '../../../api/src/results/contract';
import type { LocalDocument, StoredPage, WorkingPage } from './models';
import { toStoredPage } from '../redaction/burn';

const CATEGORY: Record<Domain, string> = {
  'blood-count': 'Blood count', 'white-cells': 'Blood count', platelets: 'Blood count',
  thyroid: 'Thyroid tests', metabolic: 'Glucose tests', kidney: 'Kidney tests',
  electrolytes: 'Electrolytes', liver: 'Liver tests', lipids: 'Lipid panel', iron: 'Iron tests',
  inflammation: 'Inflammation tests', coagulation: 'Clotting tests', autoimmune: 'Immune tests',
  vitamins: 'Vitamin tests', serology: 'Infection tests', other: 'Lab results',
};
const PANEL_HEADINGS = new Map([
  ['full blood examination', 'Blood count'], ['full blood count', 'Blood count'],
  ['complete blood count', 'Blood count'], ['cbc', 'Blood count'], ['fbc', 'Blood count'],
  ['morfologia krwi', 'Blood count'], ['morfologia', 'Blood count'], ['blutbild', 'Blood count'],
  ['thyroid function tests', 'Thyroid tests'], ['thyroid panel', 'Thyroid tests'],
  ['lipid panel', 'Lipid panel'], ['lipid profile', 'Lipid panel'], ['liver function tests', 'Liver tests'],
]);
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

/** Never copy free-form report text into a title: emit only fixed labels and a parsed report date. */
export function suggestDocumentName(pages: WorkingPage[]): string | null {
  const stored = pages.map(toStoredPage);
  const categories = new Map<string, Set<string>>();
  const add = (label: string, key: string) => categories.set(label, new Set([...(categories.get(label) ?? []), key]));
  stored.forEach((page, index) => {
    for (const observation of extractPage('local-title', index, page, detectLocale([page]))) {
      const match = matchTest(observation.name, observation.unit);
      if (match) add(CATEGORY[match.test.domain], match.test.key);
    }
    for (const line of linesOf(page)) {
      const label = PANEL_HEADINGS.get(normaliseName(textOf(line)));
      if (label && !categories.has(label)) add(label, 'heading');
    }
  });
  const labels = [...categories].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0])).map(([label]) => label);
  const date = reportDate(pages, stored);
  if (!date && !labels.length) return null;
  const content = labels.length ? labels.slice(0, 2).join(' + ') + (labels.length > 2 ? ' + more' : '') : 'Lab results';
  return date ? `${date} · ${content}` : content;
}

export function withSuggestedName(doc: LocalDocument): LocalDocument {
  if (doc.serverId || doc.status !== 'review' || doc.name !== doc.generatedName) return doc;
  const fallback = /^Lab document(?: \d+)?$/.test(doc.generatedName ?? '') ? doc.generatedName! : 'Lab document';
  const name = suggestDocumentName(doc.pages) ?? fallback;
  return name === doc.name ? doc : { ...doc, name, generatedName: name, error: undefined };
}

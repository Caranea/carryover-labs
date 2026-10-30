import { CATALOGUE } from '../../../api/src/records/catalogue';
import type { WorkingPage, WorkingWord } from '../core/models';
import { isNumericValue, isRangeToken, isResultFlag, normalizeToken, unitTokenIndices } from './text-utils';
import { detectWithRules, groupLines, isResultLine } from './rules';

const parts = (text: string): string[] => Array.from(normalizeToken(text).match(/[\p{L}\p{N}]+/gu) ?? []);
const aliases = new Map<string, string[][]>();
for (const test of CATALOGUE) for (const name of [...test.aliases, test.label]) {
  const tokens = parts(name);
  if (tokens.length) aliases.set(tokens[0], [...(aliases.get(tokens[0]) ?? []), tokens]);
}
const HEADING_WORDS = new Set(['serum', 'plasma', 'urine', 'blood', 'test', 'tests', 'result', 'results', 'and', 'surowica', 'krew']);
const PERSONAL_FIELD = /\b(?:patient|pacjent\w*|patientenname|name|surname|nazwisko|doctor|lekarz|arzt|address|adres|anschrift|street|road|strasse|phone|telefon|email|dob|birth\w*|geburts\w*|pesel|ssn|mrn|medicare|id|identifier|authorized|authorised|autoryzowal)\b/;

/** Exact test names plus their result values/flags/units, never arbitrary prose or personal fields. */
export function medicalWordIds(line: WorkingWord[], resultLine: boolean): Set<number> {
  const text = line.map(word => word.text ?? '').join(' ');
  if (PERSONAL_FIELD.test(parts(text).join(' '))) return new Set();
  const tokens = line.flatMap(word => parts(word.text ?? '').map(key => ({ key, word })));
  const matched = new Set<number>();
  for (let i = 0; i < tokens.length; i++) {
    for (const alias of aliases.get(tokens[i].key) ?? []) {
      if (alias.every((key, offset) => tokens[i + offset]?.key === key)) {
        for (let j = 0; j < alias.length; j++) matched.add(i + j);
      }
    }
  }
  const heading = matched.size > 0 && tokens.every((token, i) => matched.has(i) || HEADING_WORDS.has(token.key));
  // A combined OCR word containing a test and a person's name is not safe to exempt.
  const names = new Set(line.filter(word => {
    const indices = tokens.map((token, i) => token.word === word ? i : -1).filter(i => i >= 0);
    return indices.length && indices.every(i => matched.has(i) || (heading && HEADING_WORDS.has(tokens[i].key)));
  }).map(word => word.id));

  // A recognised test immediately followed by a short value is a result even
  // when OCR lost its unit/range. Don't depend on perfect unit recognition.
  const first = line.findIndex(word => names.has(word.id));
  let after = first;
  while (after >= 0 && after < line.length && (names.has(line[after].id) || /^[:=]$/.test(line[after].text ?? ''))) after++;
  const namedResult = first >= 0 && isNumericValue(line[after]?.text ?? '');
  if (!heading && !resultLine && !namedResult) return new Set();
  if (heading && !resultLine && !namedResult) return names;

  const units = unitTokenIndices(line.map(word => word.text ?? ''));
  const safe = new Set(names);
  line.forEach((word, index) => {
    const text = word.text ?? '';
    if (units.has(index) || isNumericValue(text) || isRangeToken(text) || isResultFlag(text) || /^[-–—<>=]$/.test(text)) safe.add(word.id);
  });
  return safe;
}

/** Also repair automatic false positives in unfinished, restored reviews. Hand-drawn masks stay intact. */
export function protectMedicalTerms(pages: WorkingPage[]): WorkingPage[] {
  let changed = false;
  const updated = pages.map(page => {
    const medical = new Set(groupLines(page.words).flatMap(line => [...medicalWordIds(line, isResultLine(line))]));
    const identity = detectWithRules(page.words, { strict: false });
    let pageChanged = false;
    const words = page.words.map(word => {
      if (!word.hidden || word.locked || word.userSet || word.source === 'you' || identity.has(word.id) || !medical.has(word.id)) return word;
      pageChanged = true;
      return { ...word, hidden: false, kind: undefined, source: undefined, score: undefined };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, words };
  });
  return changed ? updated : pages;
}

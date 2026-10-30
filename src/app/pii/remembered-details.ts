import { CATALOGUE } from '../../../api/src/records/catalogue';
import type { PiiKind, WorkingPage, WorkingWord } from '../core/models';
import { redactionPlan } from '../redaction/burn';
import { intersects } from '../redaction/geometry';
import { groupLines, isResultLine } from './rules';
import { isNumericValue, isRangeToken, isResultFlag, isUnitToken, normalizeToken } from './text-utils';
import { medicalWordIds } from './medical-terms';

export interface RememberedDetail { key: string; kind: PiiKind }
/** Source attribution lets a correction or discarded source stop teaching a false match. Local only. */
export type RememberedDetails = Record<string, RememberedDetail[]>;

export function detailKey(text: string): string {
  return normalizeToken(text).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
const COMMON = new Set(('patient name surname first last doctor dr mr mrs ms lab laboratory document test tests result results reference range date birth born sex age collected collection specimen report reported '
  + 'pacjent pacjentka imie nazwisko lekarz data urodzenia wynik wyniki norma zakres badanie badania laboratorium '
  + 'patientenname geburtsdatum geschlecht arzt ergebnis einheit referenzbereich').split(' '));
const TEST_NAMES = new Set(CATALOGUE.flatMap(test => [...test.aliases, test.label].map(detailKey)));

function eligible(text: string, kind: PiiKind): boolean {
  const key = detailKey(text);
  if (key.length < 2 || key.length > 200 || COMMON.has(key) || TEST_NAMES.has(key) || kind === 'age'
    || isUnitToken(text) || isRangeToken(text) || isNumericValue(text) || isResultFlag(text)) return false;
  if (/\p{L}/u.test(key)) return true;
  // Reuse an ID, phone or complete birth date, never a short age or lab value.
  return key.replace(/\D/g, '').length >= 7;
}

export function learnDetails(pages: WorkingPage[]): RememberedDetail[] {
  const learned = new Map<string, PiiKind>();
  const add = (text: string, kind: PiiKind) => {
    if (eligible(text, kind)) learned.set(detailKey(text), kind);
  };
  for (const page of pages) {
    const plan = redactionPlan(page);
    const hidden = new Set(page.words.filter((word, index) => plan.hidden.has(index)
      && (word.hidden || (word.box && page.regions.some(region => intersects(word.box!, region))))));
    for (const line of groupLines(page.words)) {
      // Model mistakes on numeric result rows must not teach broad redactions.
      const result = isResultLine(line);
      const medical = medicalWordIds(line, result);
      let run: WorkingWord[] = [];
      const finish = () => {
        if (run.length > 1) {
          const kind = run[0].kind ?? 'other';
          const text = run.map(w => w.text).join(' ');
          if (run.some(w => eligible(w.text!, w.kind ?? 'other')) || /^[\d\s+()./-]+$/.test(text)) add(text, kind);
        }
        run = [];
      };
      for (const word of line) {
        const drawn = word.box && page.regions.some(region => intersects(word.box!, region));
        if (!hidden.has(word) || word.locked || medical.has(word.id) || word.source === 'remembered'
          || (word.source === 'you' && !word.userSet && !drawn)
          || (result && word.source !== 'you' && !word.userSet && !drawn)) {
          finish(); continue;
        }
        const kind = word.kind ?? 'other';
        add(word.text, kind);
        // OCR can put a full name in one word or split it into several words.
        if (kind === 'person' || (word.source === 'you' && /^\p{L}+(?:\s+\p{L}+)+$/u.test(word.text))) {
          detailKey(word.text).split(' ').forEach(part => add(part, kind));
        }
        if (run.length && (run[0].kind ?? 'other') !== kind) finish();
        run.push(word);
      }
      finish();
    }
  }
  return [...learned].map(([key, kind]) => ({ key, kind }));
}

export function applyRememberedDetails(pages: WorkingPage[], memory: RememberedDetails): WorkingPage[] {
  const byStart = new Map<string, { parts: string[]; kind: PiiKind }[]>();
  const distinct = new Map(Object.values(memory).flat().map(detail => [detail.key, detail]));
  for (const { key, kind } of distinct.values()) {
    const parts = key.split(' ');
    byStart.set(parts[0], [...(byStart.get(parts[0]) ?? []), { parts, kind }]);
  }
  if (!byStart.size) return pages;
  let changed = false;
  const updated = pages.map(page => {
    const hits = new Map<number, PiiKind>();
    for (const line of groupLines(page.words)) {
      const medical = medicalWordIds(line, isResultLine(line));
      const tokens = line.flatMap(word => detailKey(word.text).split(' ').filter(Boolean).map(key => ({ key, word })));
      for (let i = 0; i < tokens.length; i++) {
        for (const candidate of byStart.get(tokens[i].key) ?? []) {
          if (!candidate.parts.every((part, offset) => tokens[i + offset]?.key === part)) continue;
          for (const token of tokens.slice(i, i + candidate.parts.length)) if (!medical.has(token.word.id)) hits.set(token.word.id, candidate.kind);
        }
      }
    }
    let pageChanged = false;
    const words = page.words.map((word): WorkingWord => {
      const kind = hits.get(word.id);
      if (!kind || word.hidden || word.locked || word.userSet || word.text === null) return word;
      pageChanged = true;
      return { ...word, hidden: true, kind, source: 'remembered', score: 1 };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, words };
  });
  return changed ? updated : pages;
}

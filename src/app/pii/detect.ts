import { PiiKind, WorkingPage, WorkingWord } from '../core/models';
import { decideLabel, WordPrediction } from './labels';
import { detectWithRules, groupLines, isProtectedResultToken, isResultLine } from './rules';
import { isNumericValue, normalizeToken } from './text-utils';
import { medicalWordIds } from './medical-terms';

export interface DetectionSettings {
  strict: boolean;
  /** Minimum model probability to hide a word. */
  threshold: number;
}

export const NORMAL: DetectionSettings = { strict: false, threshold: 0.5 };
export const STRICT: DetectionSettings = { strict: true, threshold: 0.25 };

/** Model output for one page, keyed by word id. Null when the model is unavailable. */
export type PagePredictions = Map<number, WordPrediction> | null;

/**
 * Combine rules and model predictions into hidden flags.
 * Words the user toggled and words already removed on the server are left as they are.
 */
export function applyDetections(
  pages: WorkingPage[],
  predictions: PagePredictions[],
  settings: DetectionSettings,
  /** Words from the file name that may be the patient's name (see `fileNameHints`). */
  hints: ReadonlySet<string> = new Set<string>(),
): WorkingPage[] {
  // A file-name word that is also printed in a result row is a test name ("TSH_2022.pdf"), not a person.
  if (hints.size) {
    const inResults = new Set<string>();
    for (const page of pages) {
      for (const line of groupLines(page.words)) if (isResultLine(line)) line.forEach((w) => inResults.add(normalizeToken(w.text)));
    }
    hints = new Set([...hints].filter((h) => !inResults.has(h)));
  }
  const updated = pages.map((page, p) => {
    const hits = detectWithRules(page.words, { strict: settings.strict });
    const resultLines = new Set<number>();
    const medical = new Set<number>();
    for (const line of groupLines(page.words)) {
      const result = isResultLine(line);
      if (result) resultLines.add(line[0].line);
      medicalWordIds(line, result).forEach(id => medical.add(id));
    }
    const preds = predictions[p] ?? null;

    const words = page.words.map((w): WorkingWord => {
      if (w.locked || w.userSet || w.text === null) return w;
      // Explicit identity fields still win when OCR merges them with result cells.
      const hit = hits.get(w.id);
      if (hit) return { ...w, hidden: true, kind: hit.kind, source: hit.source, score: 1 };
      if (medical.has(w.id)) return { ...w, hidden: false, kind: undefined, source: undefined, score: undefined };
      if (w.hidden && w.source === 'remembered') return w;
      if (hints.size && !resultLines.has(w.line) && hints.has(normalizeToken(w.text))) {
        return { ...w, hidden: true, kind: 'person', source: 'rule', score: 1 };
      }

      const pred = preds?.get(w.id);
      if (pred && pred.score >= settings.threshold) {
        const decision = decideLabel(pred.label);
        if (decision.hide && !isProtectedResultToken(w.text, resultLines.has(w.line))) {
          return { ...w, hidden: true, kind: decision.kind, source: 'model', score: pred.score };
        }
      }
      return { ...w, hidden: false, kind: undefined, source: undefined, score: undefined };
    });
    return { ...page, words };
  });

  return propagate(updated);
}

const PROPAGATING: PiiKind[] = ['person', 'address', 'id-number', 'national-id'];

/**
 * A name found once is hidden everywhere in the document: if "Kowalska" is
 * hidden on page 1 (by any detector or by the user), it is hidden on page 3 too.
 */
export function propagate(pages: WorkingPage[]): WorkingPage[] {
  const known = new Map<string, PiiKind>();
  for (const page of pages) {
    for (const w of page.words) {
      if (!w.hidden || w.text === null || !w.kind || w.source === 'remembered' || !PROPAGATING.includes(w.kind)) continue;
      const n = normalizeToken(w.text);
      if (n.length >= 3 && !isNumericValue(w.text)) known.set(n, w.kind);
    }
  }
  if (!known.size) return pages;

  return pages.map((page) => {
    const medical = new Set(groupLines(page.words).flatMap(line => [...medicalWordIds(line, isResultLine(line))]));
    return { ...page, words: page.words.map((w) => {
      if (w.hidden || w.userSet || w.text === null || medical.has(w.id)) return w;
      const kind = known.get(normalizeToken(w.text));
      return kind ? { ...w, hidden: true, kind, source: w.source ?? 'rule', score: 1 } : w;
    }) };
  });
}

/** Text of every hidden word, used to clean the file name. Stays on the device. */
export function hiddenWords(pages: WorkingPage[]): string[] {
  return pages.flatMap((p) => p.words.filter((w) => w.hidden && w.text !== null).map((w) => w.text as string));
}

export function countHidden(pages: WorkingPage[]): number {
  return pages.reduce((n, p) => n + p.words.filter((w) => w.hidden).length + p.regions.length, 0);
}

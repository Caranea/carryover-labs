import { WorkingPage, WorkingWord } from '../core/models';
import { decideLabel, LabelDecision, WordPrediction } from './labels';
import { detectWithRules, groupLines, identityLabelWordIds, isResultLine, Hit } from './rules';
import { isDateToken, normalizeToken } from './text-utils';
import { medicalWords } from './medical-terms';
import { applyRememberedDetails, learnDetails } from './remembered-details';

export interface DetectionSettings {
  strict: boolean;
  /** Minimum model probability to hide a word. */
  threshold: number;
  reviewThreshold: number;
}

export const PRIVACY_VERSION = 4;
// Scores are evidence, not calibrated guarantees. Lower-confidence candidates
// remain readable; a more thorough pass highlights more, rather than erasing more.
export const NORMAL: DetectionSettings = { strict: false, threshold: 0.9, reviewThreshold: 0.25 };
export const STRICT: DetectionSettings = { strict: true, threshold: 0.9, reviewThreshold: 0.15 };

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
    const hits = detectWithRules(page.words, { strict: false });
    const resultLines = new Set<number>();
    const medical = medicalWords(page.words);
    const lines = groupLines(page.words);
    const labels = new Set(lines.flatMap(line => [...identityLabelWordIds(line)]));
    for (const line of lines) {
      const result = isResultLine(line);
      if (result) resultLines.add(line[0].line);
    }
    const preds = predictions[p] ?? null;

    const words = page.words.map((w): WorkingWord => {
      if (w.locked || w.userSet || w.text === null) return w;
      const pred = preds?.get(w.id);
      w = { ...w, hidden: false, kind: undefined, source: undefined, score: undefined, candidate: undefined, prediction: pred };
      // Explicit identity fields still win when OCR merges them with result cells.
      if (labels.has(w.id)) return w;
      const hit = hits.get(w.id);
      if (hit) return { ...w, hidden: true, kind: hit.kind, source: hit.source, score: 1 };
      // Unfamiliar printed test labels are not identity evidence. Explicit identity hits above still win.
      if (medical.has(w.id) || resultLines.has(w.line)) return w;

      if (pred) {
        const decision = decideLabel(pred.label);
        if (decision.hide && pred.score >= settings.threshold && supportsIdentity(w, decision, lines.find(line => line[0].line === w.line) ?? [], hits)) {
          return { ...w, hidden: true, kind: decision.kind, source: 'model', score: pred.score };
        }
        if ((decision.hide || decision.review) && pred.score >= settings.reviewThreshold) {
          return { ...w, candidate: decision.kind };
        }
      }
      // A filename can describe a test. It is a hint to inspect, never identity evidence by itself.
      return hints.has(normalizeToken(w.text!)) ? { ...w, candidate: 'person' } : w;
    });
    return { ...page, words };
  });

  return propagate(updated);
}

/** A confident category must agree with the text's shape and its field context. */
function supportsIdentity(word: WorkingWord, decision: LabelDecision, line: WorkingWord[], hits: Map<number, Hit>): boolean {
  const text = (word.text ?? '').replace(/^[\s:;,(\[]+|[\s,;)\]]+$/g, '');
  if (decision.kind === 'person') return /^\p{Lu}[\p{L} .,'’-]*$/u.test(text);
  if (decision.kind === 'id-number' || decision.kind === 'national-id') {
    return /\d/.test(text) && text.replace(/[^\p{L}\p{N}]/gu, '').length >= 7 && !isDateToken(text);
  }
  if (decision.kind === 'birth-date' || decision.kind === 'age') {
    return line.some(w => ['person', 'birth-date', 'age'].includes(hits.get(w.id)?.kind ?? ''))
      && !/\b(requested|collected|reported|performed|collection)\b/i.test(line.map(w => w.text).join(' '));
  }
  if (decision.kind === 'contact') return /@|https?:\/\/|www\./i.test(text)
    || text.replace(/\D/g, '').length >= 7 || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(text);
  return true;
}

/**
 * A name found once is hidden everywhere in the document: if "Kowalska" is
 * hidden on page 1 (by any detector or by the user), it is hidden on page 3 too.
 */
export function propagate(pages: WorkingPage[]): WorkingPage[] {
  return applyRememberedDetails(pages, { self: learnDetails(pages) });
}

/** Drop obsolete automatic masks, leaving every explicit user choice and drawn region intact. */
export function clearAutomaticDetections(pages: WorkingPage[]): WorkingPage[] {
  let changed = false;
  const updated = pages.map(page => {
    let pageChanged = false;
    const words = page.words.map(word => {
      if (word.locked || word.userSet || word.text === null || !(word.hidden || word.source || word.kind || word.prediction || word.candidate)) return word;
      pageChanged = true;
      return { ...word, hidden: false, source: undefined, kind: undefined, score: undefined, candidate: undefined, prediction: undefined };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, words };
  });
  return changed ? updated : pages;
}

/** Text of every hidden word, used to clean the file name. Stays on the device. */
export function hiddenWords(pages: WorkingPage[]): string[] {
  return pages.flatMap((p) => p.words.filter((w) => w.hidden && w.text !== null).map((w) => w.text as string));
}

export function countHidden(pages: WorkingPage[]): number {
  return pages.reduce((n, p) => n + p.words.filter((w) => w.hidden).length + p.regions.length, 0);
}

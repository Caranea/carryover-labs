import { PiiKind } from '../core/models';

export interface LabelDecision {
  hide: boolean;
  kind: PiiKind;
}

/**
 * Model labels we deliberately keep visible. Everything else the model flags
 * is hidden (recall first). Health categories are kept because they would
 * otherwise swallow the lab results themselves; plain dates are kept because
 * collection dates build the timeline; sex is kept because reference ranges
 * depend on it; organisations are kept so lab changes can be shown.
 */
const KEEP = [
  /HEALTH/, /MEDIC/, /DIAGNOS/, /CONDITION/, /DISEASE/, /DRUG/, /TREATMENT/, /GENETIC/, /BIOMETRIC/,
  /^DATE$/, /^DATE_?TIME$/, /^TIME$/, /^(GENDER|SEX)$/, /^ORG/, /COMPANY/, /INSTITUTION/,
];

/** Map a model's entity label (BIO-prefixed or not) to what we do with it. */
export function decideLabel(rawLabel: string): LabelDecision {
  const label = rawLabel.toUpperCase().replace(/^[BIES][-_]/, '');
  if (label === 'O' || label === '') return { hide: false, kind: 'other' };
  if (/BIRTH|DOB/.test(label)) return { hide: true, kind: 'birth-date' };
  if (/PESEL|NATIONAL|SSN|SOCIAL_?SEC/.test(label)) return { hide: true, kind: 'national-id' };
  // Identifiers win over the health keep-list ("MEDICAL_RECORD_NUMBER", "HEALTH_INSURANCE_ID").
  if (/NUMBER|RECORD|MRN|INSURANCE|POLICY|ACCOUNT|IBAN|CARD|PASSPORT|LICEN|(^|_)ID($|_)/.test(label)) {
    return { hide: true, kind: 'id-number' };
  }
  if (KEEP.some((re) => re.test(label))) return { hide: false, kind: 'other' };
  if (/^AGE$/.test(label)) return { hide: true, kind: 'age' };
  if (/PHONE|EMAIL|E_MAIL|TEL|FAX|URL|IP_?ADDRESS|USERNAME|HANDLE/.test(label)) return { hide: true, kind: 'contact' };
  if (/PESEL|NATIONAL|SSN|SOCIAL_?SEC/.test(label)) return { hide: true, kind: 'national-id' };
  if (/ADDR|STREET|CITY|ZIP|POSTAL|POSTCODE|LOC|GPE|COUNTRY|STATE|BUILDING|REGION|DISTRICT/.test(label)) {
    return { hide: true, kind: 'address' };
  }
  if (/PER|NAME|SURNAME|FIRST|LAST/.test(label)) return { hide: true, kind: 'person' };
  if (/ID|NUM|NO$|IBAN|ACCOUNT|CARD|PASSPORT|LICEN|INSURANCE|TAX|NIP|REGON|VAT|PLATE/.test(label)) {
    return { hide: true, kind: 'id-number' };
  }
  return { hide: true, kind: 'other' };
}

/** Per-word model output: the most likely non-"O" label and its probability. */
export interface WordPrediction {
  label: string;
  score: number;
}

/**
 * Collapse sub-token probabilities to one prediction per word: take, across the
 * word's tokens, the highest-probability label other than "O". Taking the max
 * (not just the first sub-token) favours recall.
 */
export function aggregateWord(tokenProbs: number[][], id2label: Record<number, string>): WordPrediction {
  let best: WordPrediction = { label: 'O', score: 0 };
  for (const probs of tokenProbs) {
    probs.forEach((p, i) => {
      const label = id2label[i] ?? 'O';
      if (label !== 'O' && p > best.score) best = { label, score: p };
    });
  }
  return best;
}

export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
  const exps = Array.from({ length: logits.length }, (_, i) => Math.exp(logits[i] - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

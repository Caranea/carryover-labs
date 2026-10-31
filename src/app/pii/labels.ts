import { PiiKind } from '../core/models';

export interface LabelDecision {
  hide: boolean;
  kind: PiiKind;
  review?: boolean;
}

/**
 * Clinical information belongs in the record. An unknown or broad model
 * category is a suggestion to inspect, never permission to erase text.
 */
const KEEP = [
  /HEALTH/,
  /MEDIC/,
  /DIAGNOS/,
  /CONDITION/,
  /DISEASE/,
  /DRUG/,
  /TREATMENT/,
  /GENETIC/,
  /BIOMETRIC/,
  /^DATE$/,
  /^DATE_?TIME$/,
  /^TIME$/,
  /^(GENDER|SEX)$/,
  /^ORG/,
  /COMPANY/,
  /INSTITUTION/,
];

/** Map a model's entity label (BIO-prefixed or not) to what we do with it. */
export function decideLabel(rawLabel: string): LabelDecision {
  const label = rawLabel.toUpperCase().replace(/^[BIES][-_]/, '');
  if (label === 'O' || label === '') return { hide: false, kind: 'other' };
  if (/^(DATE_OF_BIRTH|BIRTH_DATE|DOB)$/.test(label)) return { hide: true, kind: 'birth-date' };
  if (/^(PESEL|NATIONAL_ID|SSN|SOCIAL_SECURITY_NUMBER)$/.test(label))
    return { hide: true, kind: 'national-id' };
  if (
    /^(PHONE_NUMBER|PHONE|EMAIL_ADDRESS|EMAIL|E_MAIL|FAX|CONTACT_HANDLE|IP_ADDRESS|IDENTIFYING_LINK|USERNAME)$/.test(
      label,
    )
  )
    return { hide: true, kind: 'contact' };
  if (
    /^(PERSON_IDENTIFIER|DOCUMENT_IDENTIFIER|DEVICE_IDENTIFIER|VEHICLE_IDENTIFIER|ACCOUNT_IDENTIFIER|BANK_ACCOUNT_IDENTIFIER|AUTH_SECRET|PAYMENT_CARD|PAYMENT_CARD_SECURITY|ID_NUMBER|MEDICAL_RECORD_NUMBER|HEALTH_INSURANCE_ID|MRN|PASSPORT_NUMBER|IBAN)$/.test(
      label,
    )
  ) {
    return { hide: true, kind: 'id-number' };
  }
  if (KEEP.some((re) => re.test(label))) return { hide: false, kind: 'other' };
  if (/^AGE$/.test(label)) return { hide: true, kind: 'age' };
  if (/^(POSTAL_ADDRESS|STREET_ADDRESS|ADDRESS)$/.test(label))
    return { hide: true, kind: 'address' };
  if (/^(PERSON_NAME|PERSON_ALIAS|PERSON|PER|FIRST_NAME|LAST_NAME|SURNAME)$/.test(label))
    return { hide: true, kind: 'person' };
  const kind = /^(PROPER_NAME|PERSON_ATTRIBUTE|PERSON_ROLE_OR_TITLE)$/.test(label)
    ? 'person'
    : /^(LOCATION|GEO_LOCATION|LOC|GPE)$/.test(label)
      ? 'address'
      : 'other';
  return { hide: false, review: true, kind };
}

/** Per-word model output, including the outside/non-PII class. */
export interface WordPrediction {
  label: string;
  score: number;
}

/**
 * Combine BIO variants of an entity, then average over the entire word.
 * One unusual fragment must not override the rest of the word voting for O.
 */
export function aggregateWord(
  tokenProbs: number[][],
  id2label: Record<number, string>,
): WordPrediction {
  const totals = new Map<string, number>();
  for (const probs of tokenProbs) {
    probs.forEach((p, i) => {
      const label = (id2label[i] ?? 'O').replace(/^[BIES][-_]/, '');
      totals.set(label, (totals.get(label) ?? 0) + p / tokenProbs.length);
    });
  }
  let best: WordPrediction = { label: 'O', score: 0 };
  for (const [label, score] of totals) if (score > best.score) best = { label, score };
  return { ...best, score: Math.min(1, Math.max(0, best.score)) };
}

export function softmax(logits: ArrayLike<number>): number[] {
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) max = Math.max(max, logits[i]);
  const exps = Array.from({ length: logits.length }, (_, i) => Math.exp(logits[i] - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  return exps.map((e) => e / sum);
}

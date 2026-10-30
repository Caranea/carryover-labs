import { DetectionSource, PiiKind, WorkingWord } from '../core/models';

export const KIND_LABEL: Record<PiiKind, string> = {
  person: 'name',
  address: 'address',
  'national-id': 'PESEL or national ID',
  'id-number': 'ID or record number',
  contact: 'phone or e-mail',
  'birth-date': 'date of birth',
  age: 'age',
  other: 'other detail',
};

export const KIND_PLURAL: Record<PiiKind, string> = {
  person: 'names',
  address: 'address parts',
  'national-id': 'PESEL or national IDs',
  'id-number': 'ID or record numbers',
  contact: 'phone numbers or e-mails',
  'birth-date': 'dates of birth',
  age: 'ages',
  other: 'other details',
};

const SOURCE_LABEL: Record<DetectionSource, string> = {
  model: 'found by the on-device detector',
  rule: 'found by a pattern',
  you: 'hidden by you',
  remembered: 'matched a detail hidden in another document',
};

/** Tooltip text for a hidden word. Includes the word itself: this never leaves the device. */
export function describeWord(w: WorkingWord, withText: boolean): string {
  if (w.locked) return 'Already removed from the saved copy';
  const kind = KIND_LABEL[w.kind ?? 'other'];
  const source = w.source ? SOURCE_LABEL[w.source] : '';
  const score = w.source === 'model' && w.score ? ` (${Math.round(w.score * 100)}% sure)` : '';
  const text = withText && w.text ? `“${w.text}”: ` : '';
  return `${text}${kind}, ${source}${score}. Click to keep it.`;
}

import { describe, expect, it } from 'vitest';
import { textToWords } from '../extraction/layout';
import type { WorkingPage } from '../core/models';
import { applyDetections, NORMAL, STRICT } from './detect';
import { protectMedicalTerms } from './medical-terms';
import { applyRememberedDetails, learnDetails } from './remembered-details';
import { isProtectedResultToken, isResultLine } from './rules';
import { isUnitToken } from './text-utils';
import { toStoredPage } from '../redaction/burn';

function page(text: string): WorkingPage {
  return { index: 0, width: 1000, height: 1000, image: null, imageUrl: null, ocr: false,
    words: textToWords(text), regions: [] };
}
function detect(p: WorkingPage, strict = false) {
  // Force an incorrect model category to test the application's boundary.
  const predictions = new Map(p.words.map(w => [w.id, { label: 'B-AUTH_SECRET', score: 0.99 }]));
  return applyDetections([p], [predictions], strict ? STRICT : NORMAL)[0];
}

describe('result values and flags are protected by context, not a value allowlist', () => {
  it.each(['x10^9/L', '×10⁹/L', '10⁹/L', '× 10 ^ 9 / L', 'x 10^9 /L', 'mg / dL'])('recognises the unit %s', unit => {
    expect(isUnitToken(unit)).toBe(true);
    expect(isResultLine(textToWords(`WCC 1.4 LL ${unit}`))).toBe(true);
  });

  it.each(['WCC 1.4 LL ×10⁹/L', 'White Cell Count 1.4 LL x 10 ^ 9 / L', 'WCC 1.4 LL',
    'WCC 1.4LL', 'WCC 7.83 N', 'WCC 23.71 HH', 'Neutrophils <0.12 LL'])('keeps all clinical tokens in %s', row => {
    for (const strict of [false, true]) {
      const result = detect(page(row), strict);
      expect(result.words.filter(w => w.hidden).map(w => w.text)).toEqual([]);
      expect(toStoredPage(result).words.every(w => w.t !== null)).toBe(true);
    }
  });

  it('protects arbitrary numeric results for unfamiliar tests when a unit or range establishes the row', () => {
    for (let i = 0; i < 20; i++) {
      const value = (i * 3.917 + 0.123).toFixed(3);
      const result = detect(page(`NovelAssay ${value} LL mg / L`));
      expect(result.words.find(w => w.text === value)?.hidden).toBe(false);
      expect(result.words.find(w => w.text === 'LL')?.hidden).toBe(false);
      expect(result.words.filter(w => ['mg', '/', 'L'].includes(w.text ?? '')).every(w => !w.hidden)).toBe(true);
    }
  });

  it('recognises flags only in result context and does not make arbitrary numbers universally safe', () => {
    expect(isProtectedResultToken('LL', true)).toBe(true);
    expect(isProtectedResultToken('LL', false)).toBe(false);
    expect(detect(page('1.4')).words[0].hidden).toBe(true);
    expect(detect(page('LL')).words[0].hidden).toBe(true);
  });

  it('keeps identity fields hidden even when OCR puts them on a result row', () => {
    const result = detect(page('WCC 1.4 LL ×10⁹/L\nPatient: LL Smith\nMRN: 123456789\nAge: 14 mg/L\nDOB: 01/02/1980'));
    for (const text of ['Smith', '123456789', '14', '01/02/1980']) expect(result.words.find(w => w.text === text)?.hidden).toBe(true);
    const initials = result.words.filter(w => w.text === 'LL');
    expect(initials.map(w => w.hidden)).toEqual([false, true]);
    const repaired = protectMedicalTerms([result])[0];
    expect(repaired.words.find(w => w.text === '14')?.hidden).toBe(true);
  });

  it('repairs old model/remembered mistakes without undoing manual choices', () => {
    const original = page('WCC 1.4 LL ×10⁹/L');
    original.words = original.words.map(w => ({ ...w, hidden: true, kind: 'other', source: 'model' }));
    expect(protectMedicalTerms([original])[0].words.every(w => !w.hidden)).toBe(true);
    original.words[1] = { ...original.words[1], source: 'you', userSet: true };
    expect(protectMedicalTerms([original])[0].words[1].hidden).toBe(true);
    expect(detect(original).words[1].hidden).toBe(true);
  });

  it('does not spread LL or a result value as personal data to other reports', () => {
    const original = page('WCC 1.4 LL ×10⁹/L');
    original.words = original.words.map(w => ({ ...w, hidden: true, kind: 'other', source: 'model' }));
    expect(learnDetails([original])).toEqual([]);
    const historical = { older: [{ key: 'll', kind: 'other' as const }, { key: '1 4', kind: 'other' as const }] };
    expect(applyRememberedDetails([page('WCC 1.4 LL ×10⁹/L')], historical)[0].words.every(w => !w.hidden)).toBe(true);
  });
});

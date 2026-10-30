import { describe, expect, it } from 'vitest';
import { textToWords } from '../extraction/layout';
import type { WorkingPage } from '../core/models';
import { applyDetections, NORMAL, STRICT } from './detect';
import { protectMedicalTerms } from './medical-terms';
import { applyRememberedDetails, learnDetails } from './remembered-details';
import { isProtectedResultToken, isResultLine } from './rules';
import { isUnitToken } from './text-utils';
import { toStoredPage } from '../redaction/burn';
import { PHOTO_RESULT_ROWS } from './result-photo-fixtures';

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
      expect(result.words.find(w => w.text === 'NovelAssay')?.hidden).toBe(false);
      expect(result.words.filter(w => ['mg', '/', 'L'].includes(w.text ?? '')).every(w => !w.hidden)).toBe(true);
    }
  });

  it('does not call a large result an identifier merely because it has many digits', () => {
    const result = detect(page('NovelAssay 123456789 IU/L\nNovelAssay 44051401359 IU/L\nMRN: 123456789\nPESEL: 44051401359'));
    expect(result.words.filter(w => w.hidden).map(w => [w.line, w.text])).toEqual([[2, '123456789'], [3, '44051401359']]);
  });

  it.each(PHOTO_RESULT_ROWS.map((rows, index) => ({ rows, index })))('protects the entire photographed table $index, including OCR mistakes and overlapping boxes', ({ rows }) => {
    const original = page('Patient: Jane Doe\nMRN: 123456789');
    const first = original.words.length;
    original.width = 1958; original.height = 2600; original.ocr = true;
    original.words.push(...rows.map(([text, line, x, y, w, h], index) => ({ text, line, id: first + index,
      box: { x, y, w, h }, hidden: false })));
    for (const strict of [false, true]) {
      const result = detect(original, strict);
      expect(result.words.slice(first).filter(w => w.hidden).map(w => w.text)).toEqual([]);
      expect(toStoredPage(result).words.slice(first).every(w => w.t !== null)).toBe(true);
      expect(result.words.find(w => w.text === 'Jane')?.hidden).toBe(true);
      expect(result.words.find(w => w.text === '123456789')?.hidden).toBe(true);
      const restored = { ...result, words: result.words.map(w => ({ ...w, hidden: true, source: 'model' as const })) };
      expect(protectMedicalTerms([restored])[0].words.slice(first).every(w => !w.hidden)).toBe(true);
      const learned = learnDetails([restored]);
      expect(learned.some(d => /hazematocrt|ineutrophis|10m2|final/.test(d.key))).toBe(false);
      const memory = { old: rows.map(([text]) => ({ key: text.toLowerCase(), kind: 'other' as const })) };
      expect(applyRememberedDetails([original], memory)[0].words.slice(first).every(w => !w.hidden)).toBe(true);
    }
  });

  it('does not exempt an identity field or isolated prose between result rows', () => {
    const p = page('TestA 4 mg/L\nPatient: Jane Doe\nTestB 5 mg/L');
    p.words.forEach((w, i) => { w.box = { x: (i % 3) * 100, y: w.line * 25, w: 60, h: 15 }; });
    expect(detect(p).words.find(w => w.text === 'Jane')?.hidden).toBe(true);
    const isolated = detect(page('NovelAssay was requested by Jane Doe'));
    expect(isolated.words.filter(w => w.hidden).map(w => w.text)).toEqual(['Jane', 'Doe']);
    // An arbitrary AUTH_SECRET prediction is insufficient to erase prose.
    expect(detect(page('Jane attends INR clinic')).words[0]).toMatchObject({ hidden: false, candidate: 'id-number' });
    const person = page('Jane requested Urea 5');
    expect(applyDetections([person], [new Map([[0, { label: 'PERSON_NAME', score: 0.99 }]])], NORMAL)[0].words[0].hidden).toBe(true);
  });

  it('recognises flags only in result context and does not make arbitrary numbers universally safe', () => {
    expect(isProtectedResultToken('LL', true)).toBe(true);
    expect(isProtectedResultToken('LL', false)).toBe(false);
    expect(detect(page('1.4')).words[0]).toMatchObject({ hidden: false, candidate: 'id-number' });
    expect(detect(page('LL')).words[0]).toMatchObject({ hidden: false, candidate: 'id-number' });
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

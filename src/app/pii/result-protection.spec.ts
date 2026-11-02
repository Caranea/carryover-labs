import { describe, expect, it } from 'vitest';
import { textToWords } from '../../testing/words';
import type { WorkingPage } from '../core/models';
import { applyDetections, NORMAL, STRICT } from './detect';
import { protectMedicalTerms } from './medical-terms';
import { applyRememberedDetails, learnDetails } from './remembered-details';
import { isResultLine } from './rules';
import { isUnitToken } from './text-utils';
import { toStoredPage } from '../redaction/burn';

/** Invented OCR-style rows with typical recognition noise. Not derived from any real report. */
const SYNTHETIC_OCR_ROWS: [string, number, number, number, number, number][] = [
  ['Haemoglobln', 20, 200, 1400, 154, 24],
  ['132', 20, 384, 1400, 42, 24],
  ['g/L', 20, 456, 1400, 42, 24],
  ['120', 20, 528, 1400, 42, 24],
  ['-', 20, 600, 1400, 14, 24],
  ['160', 20, 644, 1400, 42, 24],
  ['Flnal', 20, 716, 1400, 70, 24],
  ['Whlte', 21, 200, 1445, 70, 24],
  ['Cell', 21, 300, 1445, 56, 24],
  ['Count', 21, 386, 1445, 70, 24],
  ['1.4', 21, 486, 1445, 42, 24],
  ['LL', 21, 558, 1445, 28, 24],
  ['x', 21, 616, 1445, 14, 24],
  ['10°9/L', 21, 660, 1445, 84, 24],
  ['4.0-11.0', 21, 774, 1445, 112, 24],
  ['Final', 21, 916, 1445, 70, 24],
  ['Platelet', 22, 200, 1490, 112, 24],
  ['Countt', 22, 342, 1490, 84, 24],
  ['12', 22, 456, 1490, 28, 24],
  ['LL', 22, 514, 1490, 28, 24],
  ['x', 22, 572, 1490, 14, 24],
  ['109/L', 22, 616, 1490, 70, 24],
  ['150-400', 22, 716, 1490, 98, 24],
  ['Final', 22, 844, 1490, 70, 24],
  ['Neutrophis', 23, 200, 1535, 140, 24],
  ['0.51', 23, 370, 1535, 56, 24],
  ['LL', 23, 456, 1535, 28, 24],
  ['x', 23, 514, 1535, 14, 24],
  ['10M9/L', 23, 558, 1535, 84, 24],
  ['2.0-7.5', 23, 672, 1535, 98, 24],
  ['Final', 23, 800, 1535, 70, 24],
  ['|MCV', 24, 200, 1580, 56, 24],
  ['88', 24, 286, 1580, 28, 24],
  ['N', 24, 344, 1580, 14, 24],
  ['fL', 24, 388, 1580, 28, 24],
  ['80-100', 24, 446, 1580, 84, 24],
  ['Final', 24, 560, 1580, 70, 24],
];

function page(text: string): WorkingPage {
  return {
    index: 0,
    width: 1000,
    height: 1000,
    image: null,
    imageUrl: null,
    ocr: false,
    words: textToWords(text),
    regions: [],
  };
}
function detect(p: WorkingPage, strict = false) {
  // Force an incorrect model category to test the application's boundary.
  const predictions = new Map(p.words.map((w) => [w.id, { label: 'B-AUTH_SECRET', score: 0.99 }]));
  return applyDetections([p], [predictions], strict ? STRICT : NORMAL)[0];
}

describe('result values and flags are protected by context, not a value allowlist', () => {
  it.each(['x10^9/L', '×10⁹/L', '10⁹/L', '× 10 ^ 9 / L', 'x 10^9 /L', 'mg / dL'])(
    'recognises the unit %s',
    (unit) => {
      expect(isUnitToken(unit)).toBe(true);
      expect(isResultLine(textToWords(`WCC 1.4 LL ${unit}`))).toBe(true);
    },
  );

  it.each([
    'WCC 1.4 LL ×10⁹/L',
    'White Cell Count 1.4 LL x 10 ^ 9 / L',
    'WCC 1.4 LL',
    'WCC 1.4LL',
    'WCC 7.83 N',
    'WCC 23.71 HH',
    'Neutrophils <0.12 LL',
  ])('keeps all clinical tokens in %s', (row) => {
    for (const strict of [false, true]) {
      const result = detect(page(row), strict);
      expect(result.words.filter((w) => w.hidden).map((w) => w.text)).toEqual([]);
      expect(toStoredPage(result).words.every((w) => w.t !== null)).toBe(true);
    }
  });

  it('protects arbitrary numeric results for unfamiliar tests when a unit or range establishes the row', () => {
    for (let i = 0; i < 20; i++) {
      const value = (i * 3.917 + 0.123).toFixed(3);
      const result = detect(page(`NovelAssay ${value} LL mg / L`));
      expect(result.words.find((w) => w.text === value)?.hidden).toBe(false);
      expect(result.words.find((w) => w.text === 'LL')?.hidden).toBe(false);
      expect(result.words.find((w) => w.text === 'NovelAssay')?.hidden).toBe(false);
      expect(
        result.words.filter((w) => ['mg', '/', 'L'].includes(w.text ?? '')).every((w) => !w.hidden),
      ).toBe(true);
    }
  });

  it('does not call a large result an identifier merely because it has many digits', () => {
    const result = detect(
      page(
        'NovelAssay 123456789 IU/L\nNovelAssay 44051401359 IU/L\nMRN: 123456789\nPESEL: 44051401359',
      ),
    );
    expect(result.words.filter((w) => w.hidden).map((w) => [w.line, w.text])).toEqual([
      [2, '123456789'],
      [3, '44051401359'],
    ]);
  });

  it('protects an entire photographed table, including OCR mistakes', () => {
    const rows = SYNTHETIC_OCR_ROWS;
    const original = page('Patient: Jane Doe\nMRN: 123456789');
    const first = original.words.length;
    original.width = 1958;
    original.height = 2600;
    original.ocr = true;
    original.words.push(
      ...rows.map(([text, line, x, y, w, h], index) => ({
        text,
        line,
        id: first + index,
        box: { x, y, w, h },
        hidden: false,
      })),
    );
    for (const strict of [false, true]) {
      const result = detect(original, strict);
      expect(
        result.words
          .slice(first)
          .filter((w) => w.hidden)
          .map((w) => w.text),
      ).toEqual([]);
      expect(
        toStoredPage(result)
          .words.slice(first)
          .every((w) => w.t !== null),
      ).toBe(true);
      expect(result.words.find((w) => w.text === 'Jane')?.hidden).toBe(true);
      expect(result.words.find((w) => w.text === '123456789')?.hidden).toBe(true);
      const restored = {
        ...result,
        words: result.words.map((w) => ({ ...w, hidden: true, source: 'model' as const })),
      };
      expect(
        protectMedicalTerms([restored])[0]
          .words.slice(first)
          .every((w) => !w.hidden),
      ).toBe(true);
      const learned = learnDetails([restored]);
      expect(learned.some((d) => /haemoglobln|neutrophis|10m9|final/.test(d.key))).toBe(false);
      const memory = {
        old: rows.map(([text]) => ({ key: text.toLowerCase(), kind: 'other' as const })),
      };
      expect(
        applyRememberedDetails([original], memory)[0]
          .words.slice(first)
          .every((w) => !w.hidden),
      ).toBe(true);
    }
  });

  it('does not exempt an identity field or isolated prose between result rows', () => {
    const p = page('TestA 4 mg/L\nPatient: Jane Doe\nTestB 5 mg/L');
    p.words.forEach((w, i) => {
      w.box = { x: (i % 3) * 100, y: w.line * 25, w: 60, h: 15 };
    });
    expect(detect(p).words.find((w) => w.text === 'Jane')?.hidden).toBe(true);
    const isolated = detect(page('NovelAssay was requested by Jane Doe'));
    expect(isolated.words.filter((w) => w.hidden).map((w) => w.text)).toEqual(['Jane', 'Doe']);
    // An arbitrary AUTH_SECRET prediction is insufficient to erase prose.
    expect(detect(page('Jane attends INR clinic')).words[0]).toMatchObject({
      hidden: false,
      candidate: 'id-number',
    });
    const person = page('Jane requested Urea 5');
    expect(
      applyDetections([person], [new Map([[0, { label: 'PERSON_NAME', score: 0.99 }]])], NORMAL)[0]
        .words[0].hidden,
    ).toBe(true);
  });

  it('does not make arbitrary numbers or flags universally safe outside a result row', () => {
    expect(detect(page('1.4')).words[0]).toMatchObject({ hidden: false, candidate: 'id-number' });
    expect(detect(page('LL')).words[0]).toMatchObject({ hidden: false, candidate: 'id-number' });
  });

  it('keeps identity fields hidden even when OCR puts them on a result row', () => {
    const result = detect(
      page('WCC 1.4 LL ×10⁹/L\nPatient: LL Smith\nMRN: 123456789\nAge: 14 mg/L\nDOB: 01/02/1980'),
    );
    for (const text of ['Smith', '123456789', '14', '01/02/1980'])
      expect(result.words.find((w) => w.text === text)?.hidden).toBe(true);
    const initials = result.words.filter((w) => w.text === 'LL');
    expect(initials.map((w) => w.hidden)).toEqual([false, true]);
    const repaired = protectMedicalTerms([result])[0];
    expect(repaired.words.find((w) => w.text === '14')?.hidden).toBe(true);
  });

  it('repairs old model/remembered mistakes without undoing manual choices', () => {
    const original = page('WCC 1.4 LL ×10⁹/L');
    original.words = original.words.map((w) => ({
      ...w,
      hidden: true,
      kind: 'other',
      source: 'model',
    }));
    expect(protectMedicalTerms([original])[0].words.every((w) => !w.hidden)).toBe(true);
    original.words[1] = { ...original.words[1], source: 'you', userSet: true };
    expect(protectMedicalTerms([original])[0].words[1].hidden).toBe(true);
    expect(detect(original).words[1].hidden).toBe(true);
  });

  it('does not spread LL or a result value as personal data to other reports', () => {
    const original = page('WCC 1.4 LL ×10⁹/L');
    original.words = original.words.map((w) => ({
      ...w,
      hidden: true,
      kind: 'other',
      source: 'model',
    }));
    expect(learnDetails([original])).toEqual([]);
    const historical = {
      older: [
        { key: 'll', kind: 'other' as const },
        { key: '1 4', kind: 'other' as const },
      ],
    };
    expect(
      applyRememberedDetails([page('WCC 1.4 LL ×10⁹/L')], historical)[0].words.every(
        (w) => !w.hidden,
      ),
    ).toBe(true);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { SavedDocument, StoredPage, StoredWord } from '../documents/contract.js';
import { extractDocument } from './extract.js';
import { detectLocale } from './locale.js';
import { parseNumber, parseRange, toIsoDate } from './tokens.js';

/**
 * Build a page from text lines laid out on a grid: each line is a list of
 * [text, column x]; words in one cell are spread from that x.
 */
function page(lines: (string | [string, number][])[], hidden: string[] = []): StoredPage {
  const words: StoredWord[] = [];
  lines.forEach((line, l) => {
    const cells: [string, number][] = typeof line === 'string' ? [[line, 40]] : line;
    for (const [text, x0] of cells) {
      let x = x0;
      for (const w of text.split(/\s+/).filter(Boolean)) {
        const isHidden = hidden.includes(w);
        words.push({ t: isHidden ? null : w, b: [x, 20 + l * 30, w.length * 9, 18], l, ...(isHidden ? { h: true as const } : {}) });
        x += w.length * 9 + 9;
      }
    }
  });
  return { index: 0, width: 1200, height: 1700, hasImage: true, ocr: true, words, regions: [] };
}

function doc(pages: StoredPage[]): SavedDocument {
  return { id: 'doc-1', name: 'Test', sourceKind: 'pdf', pageCount: pages.length, hiddenCount: 0, createdAt: '', updatedAt: '', pages: pages.map((p, i) => ({ ...p, index: i })) };
}

describe('tokens', () => {
  it('parses values with comparators, decimal commas and attached flags', () => {
    assert.deepEqual(parseNumber('1,59'), { value: 1.59, comparator: null, flag: null });
    assert.deepEqual(parseNumber('<0.50'), { value: 0.5, comparator: '<', flag: null });
    assert.deepEqual(parseNumber('16,1H'), { value: 16.1, comparator: null, flag: 'H' });
    assert.deepEqual(parseNumber('-0.25'), { value: -0.25, comparator: null, flag: null });
    assert.deepEqual(parseNumber('1.2e3'), { value: 1200, comparator: null, flag: null });
    assert.equal(parseNumber('1e999'), null);
    assert.equal(parseNumber('2022-09-05'), null);
    assert.equal(parseNumber('ICD-9'), null);
  });

  it('parses printed reference ranges', () => {
    assert.deepEqual(parseRange('0,35 - 4,94'), { low: 0.35, high: 4.94 });
    assert.deepEqual(parseRange('[3,9 - 10,2] [Gpt/l]'), { low: 3.9, high: 10.2 });
    assert.deepEqual(parseRange('< 0.50'), { low: null, high: 0.5 });
    assert.deepEqual(parseRange('(> 35)'), { low: 35, high: null });
    assert.deepEqual(parseRange('{[8.0- 14,0] [fl]'), { low: 8, high: 14 });
  });

  it('reads dates in the order the document uses', () => {
    assert.equal(toIsoDate('2022-09-05', 'DMY'), '2022-09-05');
    assert.equal(toIsoDate('05.09.2022', 'DMY'), '2022-09-05');
    assert.equal(toIsoDate('14-Jul-2012', 'DMY'), '2012-07-14');
    assert.equal(toIsoDate('07/14/2012', 'MDY'), '2012-07-14');
    assert.equal(toIsoDate('12:40', 'DMY'), null);
  });
});

describe('detectLocale', () => {
  it('finds language, decimal separator and the labelled collection date', () => {
    const locale = detectLocale([
      page([
        'Data rej.: 2022-09-01',
        'Data/godz. pobrania: 2022-09-05 08:40',
        'Badanie Wynik Jedn. Zakres referencyjny',
        'Hemoglobina 13,2 g/dl 12,0 - 16,0',
      ]),
    ]);
    assert.equal(locale.language, 'pl');
    assert.equal(locale.decimal, ',');
    assert.equal(locale.collectionDate, '2022-09-05');
    assert.equal(locale.collectionDateSource, 'label');
  });

  it('uses month names and English labels', () => {
    const locale = detectLocale([page(['Order Date : 13-Jul-2012', 'Specimen Collected : 14-Jul-2012 10:32', 'Haemoglobin 120 g/L'])]);
    assert.equal(locale.language, 'en');
    assert.equal(locale.collectionDate, '2012-07-14');
  });

  it('decides day-first from a day above 12', () => {
    const locale = detectLocale([page(['Collected 25/03/2021', 'Result 4.5 mmol/L'])]);
    assert.equal(locale.dateOrder, 'DMY');
    assert.equal(locale.collectionDate, '2021-03-25');
  });
});

describe('extractDocument', () => {
  it('reads a table with a header, ignoring sub-lines and comments', () => {
    const r = extractDocument(
      doc([
        page([
          'Data/godz. pobrania: 2022-09-05 08:40',
          [['Badanie', 40], ['Wynik', 400], ['Jedn.', 520], ['Zakres referencyjny', 640]],
          [['TSH (ICD-9: L69) 1', 40], ['1,59', 400], ['µIU/ml*', 520], ['0,35 - 4,94', 640]],
          [['I trymestr: 0,09-2,82 µIU/ml', 60]],
          [['Badanie wykonane testem firmy Abbott.', 60]],
          [['FT4 (ICD-9: O69)', 40], ['1,15', 400], ['ng/dl*', 520], ['0,70 - 1,48', 640]],
        ]),
      ]),
    );
    assert.equal(r.observations.length, 2);
    const [tsh, ft4] = r.observations;
    assert.equal(tsh.name, 'TSH (ICD-9: L69)');
    assert.equal(tsh.value, 1.59);
    assert.equal(tsh.unit, 'µIU/ml*');
    assert.deepEqual([tsh.refLow, tsh.refHigh], [0.35, 4.94]);
    assert.equal(tsh.date, '2022-09-05');
    assert.equal(ft4.value, 1.15);
  });

  it('stores the page and a box around every word used', () => {
    const r = extractDocument(
      doc([
        page([
          [['Badanie', 40], ['Wynik', 400], ['Jedn.', 520], ['Norma', 640]],
          [['Glukoza', 40], ['92', 400], ['mg/dl', 520], ['70 - 99', 640]],
        ]),
      ]),
    );
    const o = r.observations[0];
    assert.equal(o.page, 0);
    assert.equal(o.documentId, 'doc-1');
    assert.equal(o.words.length, 6);
    assert.ok(o.bbox && o.bbox[0] === 40 && o.bbox[0] + o.bbox[2] >= 640);
  });

  it('reads MIN and MAX columns and the flag column', () => {
    const r = extractDocument(
      doc([
        page([
          [['Badanie', 40], ['Wynik', 300], ['Jedn.', 400], ['MIN', 520], ['MAX', 600], ['FLAGA', 700]],
          [['Płytki krwi', 40], ['98', 300], ['tys/µl*', 400], ['180', 520], ['430', 600], ['L', 700]],
        ]),
      ]),
    );
    const o = r.observations[0];
    assert.equal(o.name, 'Płytki krwi');
    assert.deepEqual([o.value, o.refLow, o.refHigh, o.flag], [98, 180, 430, 'L']);
  });

  it('reads "Result Flag" as the flag column and skips label lines between tables', () => {
    const r = extractDocument(
      doc([
        page([
          [['Observation', 40], ['Value', 300], ['Result Flag', 420], ['Units', 560], ['Ref. Range', 700], ['Status', 880]],
          [['Platelet Count', 40], ['12', 300], ['LL', 420], ['x 10^9/L', 560], ['150 - 400', 700], ['Final', 880]],
          [['Order Number :', 40], ['123123123', 300]],
          [['Specimen Collected :', 40], ['14-Jul-2012', 300]],
        ]),
      ]),
    );
    assert.equal(r.observations.length, 1);
    const o = r.observations[0];
    assert.deepEqual([o.name, o.value, o.flag, o.unit, o.refLow, o.refHigh], ['Platelet Count', 12, 'LL', 'x 10^9/L', 150, 400]);
  });

  it('reads reports without a header, with the range on the next line', () => {
    const r = extractDocument(
      doc([
        page([
          'Auftragsdatum 03.03.2022 07:45',
          [['Leukozyten i. VB.', 40], ['4.82', 580]],
          [['[3,9 - 10,2] [Gpt/l]', 40]],
          [['Glucose i.P. (SI-Einheit) Entscheidungsgrenze für Diabetes mellitus >= 7,0 mmol/l', 40]],
        ]),
      ]),
    );
    assert.equal(r.observations.length, 1);
    const o = r.observations[0];
    assert.deepEqual([o.name, o.value, o.unit, o.refLow, o.refHigh], ['Leukozyten i. VB.', 4.82, 'Gpt/l', 3.9, 10.2]);
    assert.equal(r.locale.collectionDate, null); // order date is not a collection date
  });

  it('never uses hidden words', () => {
    const r = extractDocument(
      doc([
        page(
          [
            [['Badanie', 40], ['Wynik', 400], ['Jedn.', 520], ['Norma', 640]],
            [['Kreatynina', 40], ['0,8', 400], ['mg/dl', 520], ['0,5 - 1,1', 640]],
          ],
          ['Kreatynina'],
        ),
      ]),
    );
    assert.equal(r.observations.length, 0);
  });

  it('reads qualitative results in a table and a lab mark after the range', () => {
    const r = extractDocument(
      doc([
        page([
          [['Badanie', 40], ['Wynik', 400], ['Jedn.', 520], ['Zakres referencyjny', 640]],
          [['Przeciwciała anty HCV', 40], ['niereaktywny', 400]],
          [['Leukocyty', 40], ['3,1', 400], ['tys/µl', 520], ['4,0-10,0 L', 640]],
        ]),
      ]),
    );
    assert.equal(r.observations.length, 2);
    assert.deepEqual([r.observations[0].value, r.observations[0].valueText], [null, 'niereaktywny']);
    assert.deepEqual([r.observations[1].flag, r.observations[1].refText, r.observations[1].refHigh], ['L', '4,0-10,0', 10]);
  });
});

describe('two-line names', () => {
  it('joins a generic "Wynik" row to the heading above it', () => {
    const r = extractDocument(
      doc([
        page([
          [['Badanie', 40], ['Wynik', 400], ['Jedn.', 520], ['Zakres referencyjny', 640], ['LIW', 900]],
          [['P/c. p. receptorom TSH (TRAb)', 40]],
          [['Wynik', 60], ['2,06', 400], ['IU/l', 520], ['0,00 - 1,99', 640], ['H', 900]],
        ]),
      ]),
    );
    assert.deepEqual(r.observations.map((o) => [o.name, o.value, o.flag]), [['P/c. p. receptorom TSH (TRAb) Wynik', 2.06, 'H']]);
  });
});

describe('short names', () => {
  it('reads short test codes without a header', () => {
    const r = extractDocument(doc([page([[['C4', 400], ['130', 800], ['mg/L', 880], ['(130-780)', 1100]]])]));
    assert.deepEqual(r.observations.map((o) => [o.name, o.value, o.unit, o.refLow, o.refHigh]), [['C4', 130, 'mg/L', 130, 780]]);
  });
});

describe('source fidelity', () => {
  it('never changes a value or reference interval to make them agree', () => {
    const result = extractDocument(doc([page([
      [['Badanie', 40], ['Wynik', 400], ['Jedn.', 520], ['Norma', 640]],
      [['Leukocyty', 40], ['47', 400], ['tys/u1*', 520], ['4,0-10,0', 640]],
      [['MCHC', 40], ['30,2', 400], ['g/dl', 520], ['256-322', 640]],
    ])]));
    assert.deepEqual(result.observations.map((o) => [o.value, o.valueText, o.unit, o.refLow, o.refHigh, o.refText]), [
      [47, '47', 'tys/u1*', 4, 10, '4,0-10,0'],
      [30.2, '30,2', 'g/dl', 256, 322, '256-322'],
    ]);
    assert.ok(result.observations.every((o) => !o.ocrFixes));
  });

  it('uses each page and section collection date without borrowing dates from another page', () => {
    const result = extractDocument(doc([
      page(['Collected 2022-01-01', 'TSH 1.5 mIU/L', 'Collected 2023-02-02', 'TSH 1.7 mIU/L']),
      page(['Collected 2024-03-03', 'TSH 1.8 mIU/L']),
      page(['TSH 1.9 mIU/L']),
    ]));
    assert.deepEqual(result.observations.map((o) => o.date), ['2022-01-01', '2023-02-02', '2024-03-03', null]);
  });

  it('withholds ambiguous, invalid, and unrelated dates', () => {
    for (const label of ['Specimen Collected 03/04/2024', 'Data pobrania 03/04/2024', 'Specimen Collected 2024-02-30', 'Date of birth 1990-01-01', 'Order Date 2024-01-01']) {
      const result = extractDocument(doc([page([label, 'TSH 1.5 mIU/L'])]));
      assert.equal(result.observations[0].date, null, label);
    }
    assert.equal(toIsoDate('2024-02-29', 'YMD'), '2024-02-29');
    assert.equal(toIsoDate('2023-02-29', 'YMD'), null);
  });

  it('uses explicit row dates in preference to the page collection date', () => {
    const result = extractDocument(doc([page([
      'Collected 2024-01-01',
      [['Test', 40], ['Result', 300], ['Units', 440], ['Date', 620]],
      [['TSH', 40], ['1.5', 300], ['mIU/L', 440], ['2023-02-01', 620]],
      [['TSH', 40], ['1.7', 300], ['mIU/L', 440], ['2023-03-01', 620]],
    ])]));
    assert.deepEqual(result.observations.map((o) => o.date), ['2023-02-01', '2023-03-01']);
  });
});

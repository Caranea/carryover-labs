import { describe, expect, it } from 'vitest';
import { textToWords } from '../extraction/layout';
import type { WorkingPage } from '../core/models';
import { applyDetections, clearAutomaticDetections, NORMAL, STRICT } from './detect';
import { applyRememberedDetails, learnDetails } from './remembered-details';
import { toStoredPage } from '../redaction/burn';

const page = (text: string): WorkingPage => ({
  index: 0,
  width: 1000,
  height: 1000,
  image: null,
  imageUrl: null,
  ocr: false,
  regions: [],
  words: textToWords(text),
});
const hidden = (p: WorkingPage) => p.words.filter((w) => w.hidden).map((w) => w.text);

describe('identity evidence instead of broad sensitivity', () => {
  it.each([
    'Test name: COELIAC MASTER',
    'Name of Test: C REACTIVE PROTEIN',
    'Test name: MASTER FULL BLOOD COUNT',
    'Tests Completed:CRP, R-U-Protein, E/LFT, TSH',
    'Investigation: Full Blood Count',
  ])('keeps clinical field %s and does not teach it as a name', (text) => {
    const p = page(
      `${text}\nPatient: Jane Doe\nNegative coeliac disease serology.\nC reactive protein indicates inflammation.`,
    );
    const guesses = new Map(
      p.words
        .filter((w) => w.line === 0)
        .map((w) => [w.id, { label: 'PERSON_NAME', score: 0.999 }]),
    );
    for (const settings of [NORMAL, STRICT]) {
      const [out] = applyDetections([p], [guesses], settings);
      expect(hidden(out)).toEqual(['Jane', 'Doe']);
      expect(learnDetails([out]).every((d) => /jane|doe/.test(d.key))).toBe(true);
      const [next] = applyRememberedDetails(
        [page('jane doe\ncoeliac disease\nC REACTIVE PROTEIN\nFULL BLOOD COUNT')],
        { first: learnDetails([out]) },
      );
      expect(hidden(next)).toEqual(['jane', 'doe']);
    }
  });

  it('uses field boundaries when a test name shares a line with a patient name', () => {
    expect(
      hidden(
        applyDetections([page('Test name: COELIAC MASTER Patient: Jane Doe')], [null], NORMAL)[0],
      ),
    ).toEqual(['Jane', 'Doe']);
    expect(
      hidden(
        applyDetections(
          [page('Referred by: Dr Alex Example Copy to: Dr Robin Sample')],
          [null],
          NORMAL,
        )[0],
      ),
    ).toEqual(['Dr', 'Alex', 'Example', 'Dr', 'Robin', 'Sample']);
  });

  it('shows broad guesses without erasing them, learning them, or silently burning them into saved copies', () => {
    for (const label of [
      'PROPER_NAME',
      'PERSON_ATTRIBUTE',
      'PERSON_ROLE_OR_TITLE',
      'DOCUMENT_REFERENCE',
      'NEW_CATEGORY',
    ]) {
      const p = page('Coeliac');
      const [out] = applyDetections([p], [new Map([[0, { label, score: 0.999 }]])], NORMAL);
      expect(out.words[0].hidden).toBe(false);
      expect(out.words[0].candidate).toBeDefined();
      expect(learnDetails([out])).toEqual([]);
      expect(toStoredPage(out).words[0].t).toBe('Coeliac');
      expect(JSON.stringify(toStoredPage(out))).not.toMatch(/prediction|candidate|score/);
    }
  });

  it('does not equate a high score with proof of an ID or birth date', () => {
    const p = page(
      'Verfahren\nRequested: 18/05/2012\n1.4 LL\nPatient: Jane Doe\nDOB: 01/01/1997\nMRN: AB1234567',
    );
    const guesses = new Map(
      p.words.map((w) => [
        w.id,
        { label: w.text?.includes('/') ? 'DATE_OF_BIRTH' : 'DOCUMENT_IDENTIFIER', score: 0.999 },
      ]),
    );
    const [out] = applyDetections([p], [guesses], NORMAL);
    expect(hidden(out)).toEqual(['Jane', 'Doe', '01/01/1997', 'AB1234567']);
    expect(out.words.find((w) => w.text === '18/05/2012')?.candidate).toBe('birth-date');
  });

  it('removes derived matches after correcting their source, preserving explicit hides and keeps', () => {
    const p = page('Coeliac\ncoeliac\nCoeliac');
    p.words[0] = { ...p.words[0], hidden: true, source: 'you', userSet: true };
    p.words[2] = { ...p.words[2], hidden: false, userSet: true };
    const memory = { source: learnDetails([p]) };
    const [spread] = applyRememberedDetails([p], memory);
    expect(hidden(spread)).toEqual(['Coeliac', 'coeliac']);
    const [next] = applyRememberedDetails([page('coeliac disease')], memory);
    const [repaired] = applyRememberedDetails([next], {});
    expect(hidden(repaired)).toEqual([]);
    spread.words[0] = { ...spread.words[0], hidden: false, source: undefined };
    expect(learnDetails([spread])).toEqual([]);
    expect(hidden(applyRememberedDetails([spread], {})[0])).toEqual([]);
  });

  it('repairs obsolete guesses while preserving every manual choice and area', () => {
    const p = page('Coeliac\nJane\nDoe\n1234567');
    p.words[0] = { ...p.words[0], hidden: true, source: 'rule' };
    p.words[1] = { ...p.words[1], hidden: true, source: 'you', userSet: true };
    p.words[2] = { ...p.words[2], hidden: false, userSet: true };
    p.words[3] = { ...p.words[3], text: null, hidden: true, locked: true };
    p.regions = [{ x: 10, y: 10, w: 50, h: 20 }];
    const [clean] = clearAutomaticDetections([p]);
    expect(hidden(clean)).toEqual(['Jane', null]);
    expect(clean.words[2]).toBe(p.words[2]);
    expect(clean.regions).toBe(p.regions);
  });

  it('keeps title fragments, qualifications and OCR noise from creating person masks', () => {
    for (const text of [
      'N DML Pathology',
      'B. Med., BSc. (hons)',
      'Bicarbonate 25 Nm 20.25 mr UE',
      '| { Tests Completed:SE E/LFT, SE C-REACTIVE PROTEIN, ESR',
      '| b Name of Test: NAS RV N 8B FOLATE ul',
    ]) {
      expect(hidden(applyDetections([page(text)], [null], NORMAL)[0])).toEqual([]);
    }
  });

  it('does not turn a surname or a town into a general keyword', () => {
    const [source] = applyDetections(
      [page('Doctor: Robin Sample\n123 Example Ave Demotown 0000')],
      [null],
      NORMAL,
    );
    const memory = { source: learnDetails([source]) };
    const [next] = applyRememberedDetails(
      [page('Sample Appearance\nDemotown Laboratory\nrobin sample')],
      memory,
    );
    expect(hidden(next)).toEqual(['robin', 'sample']);
  });

  it('keeps a street address private when stray OCR letters resemble a unit', () => {
    const [out] = applyDetections([page('s { 123 Example Ave Demotown 0000')], [null], NORMAL);
    expect(hidden(out)).toEqual(['123', 'Example', 'Ave', 'Demotown', '0000']);
  });
});

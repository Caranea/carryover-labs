import { describe, expect, it } from 'vitest';
import type { WorkingPage } from '../core/models';
import { applyDetections, NORMAL, STRICT } from './detect';
import { detectWithRules } from './rules';
import { applyRememberedDetails, learnDetails } from './remembered-details';
import { protectMedicalTerms } from './medical-terms';
import { redactionPlan, toStoredPage } from '../redaction/burn';

function page(lines: string[]): WorkingPage {
  let id = 0;
  return { index: 0, width: 2000, height: 2000, image: null, imageUrl: null, ocr: false, regions: [],
    words: lines.flatMap((line, row) => line.split(' ').map((text, col) => ({ id: id++, text, line: row, hidden: false,
      box: { x: col * 180, y: row * 40, w: 170, h: 20 } }))) };
}
const texts = (p: WorkingPage) => p.words.filter(w => w.hidden).map(w => w.text);

describe('details remembered across documents', () => {
  it('reuses an automatic name on a lowercase header in manual review and survives another automatic pass', () => {
    const original = applyDetections([page(['Patient: Jane Doe'])], [null], NORMAL);
    const next = applyRememberedDetails([page(['jane doe', 'janex'])], { first: learnDetails(original) });
    expect(texts(next[0])).toEqual(['jane', 'doe']);
    expect(next[0].words[0].source).toBe('remembered');
    expect(texts(applyDetections(next, [null], STRICT)[0])).toEqual(['jane', 'doe']);
    expect(learnDetails(next)).toEqual([]); // Matches cannot teach themselves indefinitely.
  });

  it('matches case, punctuation and split/combined OCR names without substring matching', () => {
    const source = page(['Jane']);
    source.words[0] = { ...source.words[0], text: 'Jane Doe', hidden: true, userSet: true, source: 'you', kind: 'person' };
    const target = page(['JANE, DOE', 'Doek']);
    expect(texts(applyRememberedDetails([target], { source: learnDetails([source]) })[0])).toEqual(['JANE,', 'DOE']);
    const combined = page(['jane']); combined.words[0].text = 'jane doe';
    expect(texts(applyRememberedDetails([combined], { source: learnDetails([source]) })[0])).toEqual(['jane doe']);
  });

  it('learns manually drawn names, not neighbours covered only by padding', () => {
    const source = page(['Jane Doe']);
    source.regions = [{ x: 0, y: 0, w: 170, h: 20 }];
    source.words[1].box!.x = 172; // Touched by the expanded mask, not by the drawn box.
    expect(redactionPlan(source).hidden.size).toBe(2);
    expect(learnDetails([source]).map(d => d.key)).toEqual(['jane']);
  });

  it('honours an explicit Keep and stops teaching a corrected source', () => {
    const source = page(['Jane']);
    source.words[0] = { ...source.words[0], hidden: true, userSet: true, source: 'you' };
    const kept = page(['jane']); kept.words[0].userSet = true;
    expect(applyRememberedDetails([kept], { source: learnDetails([source]) })[0]).toBe(kept);
    source.words[0].hidden = false;
    // A duplicate hidden by the original click must not become a new source.
    source.words.push({ id: 1, text: 'Jane', line: 1, hidden: true, source: 'you' });
    expect(learnDetails([source])).toEqual([]);
  });

  it('does not learn test names, common labels or short numeric results', () => {
    const p = page(['Lab document Patient', 'Urea', 'Creatinine', 'Uric Acid', 'SERUM C-REACTIVE PROTEIN (CRP)', '172']);
    p.words = p.words.map(w => ({ ...w, hidden: true, source: 'model', kind: 'person' }));
    expect(learnDetails([p])).toEqual([]);
  });

  it('reuses long identifiers and contact details, but never alters saved words', () => {
    const p = page(['AB123456789', 'fictional@example.com']);
    p.words = p.words.map(w => ({ ...w, hidden: true, source: 'you', userSet: true, kind: 'id-number' }));
    const next = page(['AB123456789', 'fictional@example.com']);
    next.words.push({ id: 2, text: null, line: 2, hidden: true, locked: true });
    const out = applyRememberedDetails([next], { source: learnDetails([p]) })[0];
    expect(texts(out)).toEqual(['AB123456789', 'fictional@example.com', null]);
    expect(toStoredPage(out).words.every(w => w.t === null)).toBe(true);
  });
});

describe('clinical test names are not personal details', () => {
  const rows = ['Urea', 'Creatinine', 'Uric Acid', 'SERUM C-REACTIVE PROTEIN (CRP)', 'Creatinine 1.0 mg/dL 0.5-1.2'];

  it('leaves these names visible with rules alone and even with erroneous high-confidence model labels', () => {
    const p = page(rows);
    expect([...detectWithRules(p.words, { strict: false })]).toEqual([]);
    const mistaken = new Map(p.words.map(w => [w.id, { label: 'B-PERSON', score: 0.99 }]));
    for (const settings of [NORMAL, STRICT]) expect(texts(applyDetections([p], [mistaken], settings)[0])).toEqual([]);
  });

  it('protects headings from previously remembered false positives too', () => {
    const memory = { old: ['urea', 'creatinine', 'uric', 'acid', 'c reactive', 'protein', 'crp'].map(key => ({ key, kind: 'person' as const })) };
    expect(texts(applyRememberedDetails([page(rows)], memory)[0])).toEqual([]);
  });

  it('preserves manual masks and does not exempt personal fields or mixed OCR words', () => {
    const p = page(['Urea', 'Patient: Urea', 'Creatinine Jane']);
    p.words[0] = { ...p.words[0], hidden: true, userSet: true, source: 'you' };
    p.words.splice(3, 2, { ...p.words[3], text: 'Creatinine Jane' });
    const mistaken = new Map(p.words.map(w => [w.id, { label: 'B-PERSON', score: 0.99 }]));
    const out = applyDetections([p], [mistaken], NORMAL)[0];
    expect(out.words.find(w => w.text === 'Creatinine Jane')?.hidden).toBe(true);
    expect(out.words.filter(w => w.text === 'Urea').every(w => w.hidden)).toBe(true);
    expect(protectMedicalTerms([out])[0].words[0].hidden).toBe(true);
  });

  it('repairs restored automatic masks without removing manually drawn regions', () => {
    const p = page(rows); p.regions = [{ x: 0, y: 0, w: 170, h: 20 }];
    p.words = p.words.map(w => ({ ...w, hidden: true, source: 'model', kind: 'person' }));
    const repaired = protectMedicalTerms([p])[0];
    expect(repaired.words.slice(0, 8).every(w => !w.hidden)).toBe(true);
    expect(repaired.regions).toEqual(p.regions);
    expect(toStoredPage(repaired).words[0].t).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import { documentReportDate, suggestDocumentName, withSuggestedName } from './document-name';
import type { LocalDocument, WorkingPage } from './models';

function page(lines: string[]): WorkingPage {
  let id = 0;
  return { index: 0, width: 1200, height: 1600, image: null, imageUrl: null, ocr: false, regions: [],
    words: lines.flatMap((line, row) => line.split(' ').map(text => ({ id: id++, text, line: row, hidden: false }))) };
}
const thyroid = 'TSH 2.1 mIU/L 0.4-4.0';
const doc = (pages: WorkingPage[]): LocalDocument => ({ localId: 'test', name: 'Lab document 1', generatedName: 'Lab document 1',
  fileName: 'private-file.txt', sourceKind: 'text', status: 'review', strict: false, progress: 1, message: '', pages, file: null, addedAt: 0 });

describe('document name suggestions', () => {
  it('combines a labelled report date with recognised tests without copying the patient name', () => {
    expect(suggestDocumentName([page(['Patient: Alex Example', 'Collected: 2026-10-15', thyroid])])).toBe('2026-10-15 · Thyroid tests');
    expect(suggestDocumentName([page(['Performed: 2026-10-15', 'FULL BLOOD EXAMINATION'])])).toBe('2026-10-15 · Blood count');
  });

  it('prefers collection to issue date and handles a standalone date below its label', () => {
    expect(documentReportDate([page(['Reported: 2026-10-18', 'Collection date:', '2026-10-15'])])).toBe('2026-10-15');
    expect(documentReportDate([page(['Data pobrania: 15.10.2026'])])).toBe('2026-10-15');
  });

  it('omits birth dates, unlabelled dates, ambiguous dates and conflicting report dates', () => {
    for (const lines of [['DOB: 1980-01-01'], ['1980-01-01'], ['Collected: 01/02/2026'],
      ['Collected: 2026-10-15', 'Collected: 2026-10-16'], ['Collection date:', 'DOB: 1980-01-01']]) {
      expect(suggestDocumentName([page([...lines, thyroid])])).toBe('Thyroid tests');
    }
    expect(documentReportDate([page(['Collected: 2026-10-15']), page(['Collected: 2026-10-16'])])).toBeNull();
    expect(documentReportDate([page(['Collection date:']), page(['2026-10-15'])])).toBeNull();
  });

  it('does not use hidden dates or a birthdate whose label was hidden', () => {
    const p = page(['Collected: 2026-10-15', thyroid]); p.words[1].hidden = true;
    expect(suggestDocumentName([p])).toBe('Thyroid tests');
    const birth = page(['Collection date:', 'DOB: 1980-01-01']); birth.words[2].hidden = true;
    expect(documentReportDate([birth])).toBeNull();
  });

  it('updates generated names when content is hidden but preserves a custom or saved name', () => {
    const original = doc([page(['Collected: 2026-10-15', thyroid])]);
    const suggested = withSuggestedName(original);
    expect(suggested.name).toBe('2026-10-15 · Thyroid tests');
    const hidden = suggested.pages.map(p => ({ ...p, words: p.words.map(w => ({ ...w, hidden: true })) }));
    expect(withSuggestedName({ ...suggested, pages: hidden }).name).toBe('Lab document');
    expect(withSuggestedName({ ...original, name: 'My thyroid tests' }).name).toBe('My thyroid tests');
    expect(withSuggestedName({ ...original, serverId: 'saved' }).name).toBe('Lab document 1');
    expect(withSuggestedName(doc([page(['unknown content'])])).name).toBe('Lab document 1');
  });
});

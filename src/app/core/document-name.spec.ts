import { describe, expect, it } from 'vitest';
import { documentReportDate } from './document-name';
import type { WorkingPage } from './models';

function page(lines: string[]): WorkingPage {
  let id = 0;
  return {
    index: 0,
    width: 1200,
    height: 1600,
    image: null,
    imageUrl: null,
    ocr: false,
    regions: [],
    words: lines.flatMap((line, row) =>
      line.split(' ').map((text) => ({ id: id++, text, line: row, hidden: false })),
    ),
  };
}
describe('document-name privacy validation', () => {
  it('recognises a visible report date so a neutral title is not mistaken for an identifier', () => {
    expect(
      documentReportDate([page(['Reported: 2026-10-18', 'Collection date:', '2026-10-15'])]),
    ).toBe('2026-10-15');
    expect(documentReportDate([page(['Data pobrania: 15.10.2026'])])).toBe('2026-10-15');
  });
  it('does not exempt birth dates, ambiguous dates, unlabelled dates or conflicting dates', () => {
    for (const lines of [
      ['DOB: 1980-01-01'],
      ['1980-01-01'],
      ['Collected: 01/02/2026'],
      ['Collected: 2026-10-15', 'Collected: 2026-10-16'],
      ['Collection date:', 'DOB: 1980-01-01'],
    ]) {
      expect(documentReportDate([page(lines)])).toBeNull();
    }
    expect(documentReportDate([page(['Collection date:']), page(['2026-10-15'])])).toBeNull();
  });
  it('does not use hidden dates or a birthdate whose label was hidden', () => {
    const p = page(['Collected: 2026-10-15']);
    p.words[1].hidden = true;
    expect(documentReportDate([p])).toBeNull();
    const birth = page(['Collection date:', 'DOB: 1980-01-01']);
    birth.words[2].hidden = true;
    expect(documentReportDate([birth])).toBeNull();
  });
});

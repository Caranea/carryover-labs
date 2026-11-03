import { describe, expect, it } from 'vitest';
import { DOCUMENTS, ROWS, STEPS, TRACED } from './record-film-data';
import { FILM_END, filmFrame } from './record-film-timeline';

describe('the record film', () => {
  it('has a value and a printed name for every test on every document', () => {
    for (const doc of DOCUMENTS) expect(doc.rows).toHaveLength(ROWS.length);
    for (const row of ROWS) {
      expect(row.values).toHaveLength(DOCUMENTS.length);
      expect(row.printedAs).toHaveLength(DOCUMENTS.length);
    }
  });

  it('never names the patient beside the redacted pages', () => {
    for (const doc of DOCUMENTS) expect(doc.label).not.toMatch(/jane|doe/i);
  });

  it('starts with an empty table and no pages', () => {
    const frame = filmFrame(0);
    expect(frame.activeStep).toBe(0);
    expect(frame.pages.every((p) => p.thumbOpacity === 0 && p.pageOpacity === 0)).toBe(true);
    expect(frame.cells.flat().every((c) => c.opacity === 0)).toBe(true);
  });

  it('hides personal details before any value is read', () => {
    const firstRead = filmFrame(4.5);
    expect(firstRead.activeStep).toBe(2);
    for (const page of firstRead.pages) {
      expect(page.redactions.every((bar) => bar.drawn === 1)).toBe(true);
    }
    expect(firstRead.cells.flat().every((c) => c.opacity === 0)).toBe(true);
  });

  it('shows a test under its printed name while its row is read', () => {
    const frame = filmFrame(6.4);
    expect(frame.document).toBe(2);
    expect(frame.subtitles.filter((s) => s.startsWith('Printed as'))).toHaveLength(1);
    expect(frame.pages[2].outline).not.toBeNull();
  });

  it('ends on the full table, with one value traced to its page', () => {
    const frame = filmFrame(FILM_END);
    expect(frame.activeStep).toBe(STEPS.length - 1);
    expect(frame.document).toBe(TRACED.document);
    expect(frame.cells.flat().every((c) => c.opacity === 1)).toBe(true);
    expect(frame.cells.flat().filter((c) => c.traced)).toHaveLength(1);
    expect(frame.cells[TRACED.row][TRACED.document].traced).toBe(true);
    expect(frame.pages[TRACED.document].outline).not.toBeNull();
    expect(frame.traceOpacity).toBe(1);
  });

  it('traces a value the lab flagged', () => {
    expect(ROWS[TRACED.row].low).toContain(TRACED.document);
  });
});

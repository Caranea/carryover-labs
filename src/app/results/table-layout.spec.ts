import {
  formatReference,
  layoutColumns,
  parseRange,
  printChunks,
  rangeNote,
  sparkline,
  splitDecimal,
} from './table-layout';
import { calendarTimestamp } from './calendar-date';

describe('results table layout', () => {
  it('groups dates by year and marks whole years with no tests', () => {
    const { columns, head } = layoutColumns([
      '2024-09-09',
      '2023-11-13',
      '2023-02-20',
      '2021-04-22',
      '2019-02-16',
      '2014-05-01',
      '',
    ]);
    expect(head).toEqual([
      { kind: 'year', label: '2024', span: 1 },
      { kind: 'year', label: '2023', span: 2 },
      { kind: 'gap', label: '2022' },
      { kind: 'year', label: '2021', span: 1 },
      { kind: 'gap', label: '2020' },
      { kind: 'year', label: '2019', span: 1 },
      { kind: 'gap', label: '2015–2018' },
      { kind: 'year', label: '2014', span: 1 },
      { kind: 'year', label: 'No date', span: 1 },
    ]);
    expect(columns.filter((c) => c.kind === 'date').map((c) => c.yearStart)).toEqual([
      true,
      true,
      false,
      true,
      true,
      true,
      true,
    ]);
    expect(columns.filter((c) => c.kind === 'gap')).toHaveLength(3);
  });

  it('splits plain numbers at the decimal point and leaves words whole', () => {
    expect(splitDecimal('4.35')).toEqual({ int: '4', frac: '.35' });
    expect(splitDecimal('215')).toEqual({ int: '215', frac: '' });
    expect(splitDecimal('<0.5')).toEqual({ int: '<0', frac: '.5' });
    expect(splitDecimal('1,234.5')).toEqual({ int: '1,234', frac: '.5' });
    expect(splitDecimal('negative')).toBeNull();
    expect(splitDecimal('3-5')).toBeNull();
  });

  it('prints every range with a decimal point and a range dash', () => {
    expect(formatReference('3,9 - 5,1')).toBe('3.9–5.1');
    expect(formatReference('125-396')).toBe('125–396');
    expect(formatReference('-2 - 2')).toBe('-2–2');
    expect(formatReference('< 5,0')).toBe('< 5.0');
    expect(parseRange('11,2 - 15,7')).toEqual({ lo: 11.2, hi: 15.7 });
    expect(parseRange('< 5')).toBeNull();
    expect(parseRange('5 - 1')).toBeNull();
  });

  it('spaces the trend by date and marks flagged values', () => {
    const t = (d: string) => calendarTimestamp(d);
    const s = sparkline(
      [
        { t: t('2024-01-01'), v: 175, flagged: false },
        { t: t('2019-01-01'), v: 215, flagged: false },
        { t: t('2022-08-03'), v: 78, flagged: true },
      ],
      { lo: 125, hi: 396 },
      t('2019-01-01'),
      t('2024-01-01'),
    )!;
    const xs = s.line.split(' ').map((p) => Number(p.split(',')[0]));
    expect(xs[0]).toBe(3);
    expect(xs[2]).toBe(97);
    expect(xs[1]).toBeGreaterThan(65); // Aug 2022 is ~72% of the way from 2019 to 2024
    expect(s.dots).toHaveLength(1);
    expect(s.last.x).toBe(97);
    expect(s.band!.h).toBeGreaterThan(0);
  });

  it('explains a flag inside the band when earlier reports printed another range', () => {
    const band = { lo: 21, hi: 50 };
    const point = (date: string, value: number, reference: string, flagged: boolean) => ({
      date,
      value,
      reference,
      flagged,
    });
    expect(rangeNote([point('2024-09-09', 30, '21,0 - 50,0', false)], band)).toBeNull();
    const note = rangeNote(
      [
        point('2012-05-10', 46, '20 - 45', true),
        point('2014-07-19', 44, '20 - 45', false),
        point('2019-02-16', 47, '20 - 45', true),
        point('2024-09-09', 30, '21,0 - 50,0', false),
      ],
      band,
    );
    expect(note).toContain('earlier reports printed 20–45 (2012–2019)');
    expect(rangeNote([point('2019-02-16', 47, '20 - 45', true)], null)).toBeNull();
  });

  it('splits dates into A4-wide printed tables, newest first, each laid out by year', () => {
    const dates = Array.from({ length: 16 }, (_, i) => `${2026 - i}-01-01`);
    const chunks = printChunks(dates, 6, 8);
    expect(chunks.map((c) => c.columns.filter((col) => col.kind === 'date').length)).toEqual([
      6, 8, 2,
    ]);
    expect(chunks[1].columns[0]).toEqual({ kind: 'date', date: '2020-01-01', yearStart: true });
    expect(printChunks([])).toEqual([]);
  });
});

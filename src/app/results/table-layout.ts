/**
 * Layout helpers for the cumulative results table: year-grouped date columns, decimal-aligned
 * values, readable reference ranges and the per-test trend line. Pure functions, no Angular.
 */

/** A body column: a date (YYYY-MM-DD, or '' for undated results), or a run of years with no tests. */
export type Column =
  { kind: 'date'; date: string; yearStart: boolean } | { kind: 'gap'; label: string };

/** A cell of the top header row: a year spanning its dates, or the gap marker (spans both rows). */
export type HeadCell =
  { kind: 'year'; label: string; span: number } | { kind: 'gap'; label: string };

/**
 * Dates newest first → columns grouped by year. Where whole years have no tests, a narrow gap
 * column says so, so 2019 → 2021 does not look like any other step. Undated results come last.
 */
export function layoutColumns(dates: string[]): { columns: Column[]; head: HeadCell[] } {
  const columns: Column[] = [];
  const head: HeadCell[] = [];
  let year: HeadCell | null = null;
  let previous: number | null = null;
  for (const date of dates) {
    const label = date ? date.slice(0, 4) : 'No date';
    if (year?.kind === 'year' && year.label === label) {
      year.span++;
      columns.push({ kind: 'date', date, yearStart: false });
      continue;
    }
    const current = date ? Number(label) : null;
    if (previous !== null && current !== null && previous - current > 1) {
      const gapLabel =
        previous - current === 2 ? `${current + 1}` : `${current + 1}–${previous - 1}`;
      columns.push({ kind: 'gap', label: gapLabel });
      head.push({ kind: 'gap', label: gapLabel });
    }
    year = { kind: 'year', label, span: 1 };
    head.push(year);
    columns.push({ kind: 'date', date, yearStart: true });
    previous = current;
  }
  return { columns, head };
}

/**
 * "4.35" → { int: '4', frac: '.35' }, so values line up on the decimal point. Null for words,
 * ranges or anything else that is not a single number; those are shown whole.
 */
export function splitDecimal(text: string): { int: string; frac: string } | null {
  const m = /^([<>≤≥]?\s?-?(?:\d{1,3}(?:,\d{3})+|\d+))(\.\d+)?$/.exec(text.trim());
  return m ? { int: m[1], frac: m[2] ?? '' } : null;
}

/** "3,9 - 5,1" → "3.9–5.1": one decimal point for every lab and a range dash. Digits as printed. */
export function formatReference(reference: string): string {
  return reference
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*[-–—]\s*(?=-?\d)/g, '$1–')
    .trim();
}

/** A two-sided printed range as numbers, for the band behind the trend line; null otherwise. */
export function parseRange(reference: string): { lo: number; hi: number } | null {
  const m = /^(-?\d+(?:\.\d+)?)–(-?\d+(?:\.\d+)?)(?:\s.*)?$/.exec(formatReference(reference));
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return lo < hi ? { lo, hi } : null;
}

/** One value on the trend line: when (ms, UTC calendar day), what, and whether the lab flagged it. */
export interface TrendPoint {
  t: number;
  v: number;
  flagged: boolean;
}

/** Trend line geometry in a SPARK_W × SPARK_H box; drawn stretched, so dots use round caps. */
export interface Spark {
  line: string;
  band: { y: number; h: number } | null;
  dots: { x: number; y: number }[];
  last: { x: number; y: number };
}
export const SPARK_W = 100;
export const SPARK_H = 30;

/**
 * Oldest to newest, spaced by real dates across the panel's whole time span [t0, t1], so a test
 * measured only recently starts part-way along. The band is the printed reference range.
 */
export function sparkline(
  points: TrendPoint[],
  band: { lo: number; hi: number } | null,
  t0: number,
  t1: number,
): Spark | null {
  if (!points.length) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const values = sorted.map((p) => p.v);
  let lo = Math.min(...values, ...(band ? [band.lo] : []));
  let hi = Math.max(...values, ...(band ? [band.hi] : []));
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  lo -= pad;
  hi += pad;
  const inset = 3;
  const x = (t: number) =>
    t1 === t0 ? SPARK_W / 2 : inset + ((t - t0) / (t1 - t0)) * (SPARK_W - 2 * inset);
  const y = (v: number) => inset + (1 - (v - lo) / (hi - lo)) * (SPARK_H - 2 * inset);
  const round = (n: number) => Number(n.toFixed(2));
  const at = (p: TrendPoint) => ({ x: round(x(p.t)), y: round(y(p.v)) });
  return {
    line: sorted.map((p) => `${at(p).x},${at(p).y}`).join(' '),
    band: band ? { y: round(y(band.hi)), h: round(y(band.lo) - y(band.hi)) } : null,
    dots: sorted.filter((p) => p.flagged).map(at),
    last: at(sorted.at(-1)!),
  };
}

/** A value with the range printed beside it on its own report. */
export interface RangedPoint {
  date: string;
  value: number;
  reference: string | null;
  /** Flagged high or low by the lab. */
  flagged: boolean;
}

/**
 * When a value the lab flagged high or low sits inside the band (the latest report's range),
 * the reports used different ranges: explain that, listing the earlier ranges. Null otherwise.
 */
export function rangeNote(
  points: RangedPoint[],
  band: { lo: number; hi: number } | null,
): string | null {
  if (!band || !points.some((p) => p.flagged && p.value >= band.lo && p.value <= band.hi))
    return null;
  const years = new Map<string, { from: string; to: string }>();
  for (const p of points) {
    const range = p.reference ? parseRange(p.reference) : null;
    if (!range || (range.lo === band.lo && range.hi === band.hi)) continue;
    const text = formatReference(p.reference!);
    const year = p.date.slice(0, 4);
    const span = years.get(text);
    if (!span) years.set(text, { from: year, to: year });
    else {
      if (year < span.from) span.from = year;
      if (year > span.to) span.to = year;
    }
  }
  const earlier = [...years]
    .sort(([, a], [, b]) => a.from.localeCompare(b.from))
    .map(([text, { from, to }]) => `${text} (${from === to ? from : `${from}–${to}`})`);
  const head =
    'Each flag follows the range printed on its own report. The shaded band shows the latest report’s range';
  return earlier.length
    ? `${head}; earlier reports printed ${earlier.join(', ')}.`
    : `${head}, so a value flagged on an older report can sit inside it.`;
}

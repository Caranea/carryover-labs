import type { Observation } from '../shared/results.js';
import {
  DATE_KINDS,
  type DateKind,
  type PageDate,
  type PrintedDate,
} from '../shared/processing.js';
import { toIsoDate } from '../shared/tokens.js';

const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Place a row in time when its collection date is not printed on the row: first a date printed
 * on the row itself, then a date on any page of the document that names the row's footnote
 * marker, then one that applies to the whole report. The best kind wins (collected, received,
 * performed, registered, reported); two different dates of that kind leave the row undated.
 */
export function dated<R extends Observation>(o: R, dates: PageDate[], order: DayMonth | null): R {
  if (o.date) return o;
  const own = o.transcription?.date && withIso(o.transcription.date, order);
  const marker = o.transcription?.marker;
  const found =
    (own?.iso ? { iso: own.iso, kind: own.kind } : null) ??
    best(dates.filter((d) => marker && d.marker && fold(d.marker) === fold(marker))) ??
    best(dates.filter((d) => !d.marker));
  if (!found) return o;
  return {
    ...o,
    date: found.iso,
    dateSource: 'document',
    ...(found.kind !== 'collected' ? { dateKind: found.kind } : {}),
  };
}

export type DayMonth = 'DMY' | 'MDY';
const NUMERIC_DATE = /^\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/;

/**
 * Whether "01/06/2012" means 1 June or 6 January, as other dates settle it: "21/05/2012" read
 * as 21 May means day first. Null unless every date that settles it agrees.
 */
export function dayMonthOrder(dates: PrintedDate[]): DayMonth | null {
  let dayFirst = 0;
  let monthFirst = 0;
  for (const d of dates) {
    const m = NUMERIC_DATE.exec(d.printed);
    if (!m || !d.iso) continue;
    const [a, b, y] = [m[1].padStart(2, '0'), m[2].padStart(2, '0'), m[3]];
    if (a === b) continue;
    if (d.iso === `${y}-${b}-${a}`) dayFirst++;
    else if (d.iso === `${y}-${a}-${b}`) monthFirst++;
  }
  return dayFirst && !monthFirst ? 'DMY' : monthFirst && !dayFirst ? 'MDY' : null;
}

/** An ambiguous numeric date, read in the order the other dates settled. */
export function withIso<T extends PrintedDate>(date: T, order: DayMonth | null): T {
  const m = NUMERIC_DATE.exec(date.printed);
  if (date.iso || !order || !m) return date;
  const [day, month] = order === 'DMY' ? [m[1], m[2]] : [m[2], m[1]];
  const iso = `${m[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  return toIsoDate(iso, 'YMD') === iso ? { ...date, iso } : date;
}

function best(dates: PageDate[]): { iso: string; kind: DateKind } | null {
  for (const kind of DATE_KINDS) {
    const isos = new Set(dates.filter((d) => d.kind === kind && d.iso).map((d) => d.iso!));
    if (isos.size === 1) return { iso: [...isos][0], kind };
    if (isos.size > 1) return null;
  }
  return null;
}

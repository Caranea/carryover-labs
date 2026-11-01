import type { Content, ContentTable, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { RecordPoint, RecordSeries, RecordsResponse, SourceRef } from '@shared/records';
import { calendarTimestamp } from '../results/calendar-date';
import { niceScale } from '../results/chart-scale';

export const PDF_LIMITS = {
  series: 60,
  readings: 1600,
  characters: 320_000,
  pages: 100,
  bytes: 12 * 1024 * 1024,
  milliseconds: 60_000,
} as const;
export interface AppointmentPdfInput {
  /** Only selected domains are passed into the exporter. Unresolved and written readings stay included. */
  records: RecordsResponse;
  questions: string;
  preparedAt: string;
  fictional: boolean;
}
const INK = '#16302c';
const TEAL = '#0d7a68';
const GREY = '#52645f';

export function validatePdfInput(input: AppointmentPdfInput): void {
  const series = input.records.domains.flatMap((domain) =>
    domain.charts.flatMap((chart) => chart.series),
  );
  const count =
    series.reduce((n, item) => n + item.points.length, 0) +
    input.records.warnings.length +
    input.records.textResults.length;
  if (
    series.length > PDF_LIMITS.series ||
    count > PDF_LIMITS.readings ||
    JSON.stringify(input).length > PDF_LIMITS.characters
  ) {
    throw new Error(
      'This selection is too large for one PDF. Choose fewer groups and save separate appointment records. No readings have been removed.',
    );
  }
  if (!Number.isFinite(Date.parse(input.preparedAt)))
    throw new Error('The preparation date is unavailable. Reload this page and try again.');
  if (
    series.some((item) =>
      item.points.some(
        (p) =>
          !Number.isFinite(p.value) ||
          Math.abs(p.value) > Number.MAX_VALUE / 4 ||
          !Number.isFinite(calendarTimestamp(p.date)),
      ),
    )
  ) {
    throw new Error(
      'A chart contains an invalid value or date. Check its source before exporting.',
    );
  }
}

function text(value: string | null | undefined): string {
  return (value ?? '').normalize('NFC').replace(/[^\P{Cc}\t\n\r]/gu, '');
}
function number(value: number): string {
  return String(Number(value.toPrecision(5)));
}
export function pdfValue(point: RecordPoint): string {
  return point.conversion
    ? `${point.comparator ?? ''}${number(point.value)}`
    : text(point.printedValue);
}
export function pdfDate(value: string | null): string {
  return value ? new Date(calendarTimestamp(value)).toISOString().slice(0, 10) : 'Date unknown';
}
function matchingStatus(state: RecordsResponse['model']['state']): string {
  return {
    off: 'automatic matching is not configured',
    ready: 'no matching jobs are pending',
    working: 'matching is still in progress; this snapshot may be incomplete',
    error: 'matching stopped; some readings may remain unresolved',
  }[state];
}
function refKey(ref: SourceRef): string {
  return `${ref.documentId}:${ref.page}`;
}

export function pdfSources(records: RecordsResponse): SourceRef[] {
  const points = records.domains.flatMap((d) =>
    d.charts.flatMap((c) => c.series.flatMap((s) => s.points)),
  );
  const refs = [
    ...points,
    ...points.flatMap((p) => p.alsoIn),
    ...records.textResults,
    ...records.warnings,
  ];
  const unique = new Map<string, SourceRef>();
  refs.forEach((ref) => unique.set(refKey(ref), ref));
  return [...unique.values()].sort(
    (a, b) =>
      a.documentName.localeCompare(b.documentName, 'en') ||
      a.documentId.localeCompare(b.documentId, 'en') ||
      a.page - b.page,
  );
}

function geometry(series: RecordSeries) {
  const points = [...series.points].sort(
    (a, b) => a.date.localeCompare(b.date) || a.observationId.localeCompare(b.observationId),
  );
  const times = points.map((p) => calendarTimestamp(p.date));
  let first = Math.min(...times);
  let last = Math.max(...times);
  if (first === last) {
    first -= 90 * 86_400_000;
    last += 90 * 86_400_000;
  }
  const values = points.map((p) => p.value);
  const { lo: low, hi: high, ticks } = niceScale(Math.min(...values), Math.max(...values));
  const x = (date: number) => 8 + ((date - first) / (last - first)) * 440;
  const y = (value: number) => 16 + ((high - value) / (high - low)) * 112;
  return { points, times, first, last, ticks, x, y };
}

/** Only vector shapes enter SVG. Labels are native PDF text with the bundled Unicode font. */
export function seriesSvg(series: RecordSeries): string {
  if (!series.points.length)
    return '<svg xmlns="http://www.w3.org/2000/svg" width="465" height="134"/>';
  const { points, times, ticks, x, y } = geometry(series);
  let shapes = '';
  for (const value of ticks) {
    const yy = y(value).toFixed(2);
    shapes += `<line x1="8" y1="${yy}" x2="448" y2="${yy}" stroke="#e3ebe8"/>`;
  }
  points.forEach((point, index) => {
    const xx = x(times[index]);
    const yy = y(point.value);
    if (index && !point.comparator && !points[index - 1].comparator) {
      shapes += `<line x1="${x(times[index - 1]).toFixed(2)}" y1="${y(points[index - 1].value).toFixed(2)}" x2="${xx.toFixed(2)}" y2="${yy.toFixed(2)}" stroke="${TEAL}" stroke-width="1.8"/>`;
    }
    shapes += `<circle cx="${xx.toFixed(2)}" cy="${yy.toFixed(2)}" r="3.3" stroke="${TEAL}" stroke-width="1.5" fill="${point.comparator ? '#ffffff' : TEAL}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="465" height="134" viewBox="0 0 465 134">${shapes}</svg>`;
}

function chartGraphic(series: RecordSeries): Content {
  if (!series.points.length) return { text: 'No plotted values.', style: 'muted' };
  const { first, last, ticks } = geometry(series);
  const gap = 112 / (ticks.length - 1);
  return {
    stack: [
      {
        columns: [
          {
            width: 42,
            stack: [...ticks].reverse().map((value, index) => ({
              text: number(value),
              fontSize: 9,
              lineHeight: 1,
              alignment: 'right' as const,
              color: GREY,
              margin: [0, index === 0 ? 10 : gap - 10.55, 4, 0] as [number, number, number, number],
            })),
          },
          { svg: seriesSvg(series), width: 465 },
        ],
      },
      {
        columns: [
          { text: '', width: 50 },
          { text: new Date(first).toISOString().slice(0, 10), width: '*' },
          {
            text: new Date(first + (last - first) / 2).toISOString().slice(0, 10),
            width: '*',
            alignment: 'center',
          },
          { text: new Date(last).toISOString().slice(0, 10), width: '*', alignment: 'right' },
        ],
        fontSize: 9,
        color: GREY,
        margin: [0, 0, 17, 8],
      },
    ],
  };
}
function heading(value: string): Content {
  return { text: value, style: 'section', margin: [0, 15, 0, 8] };
}
function table(
  headers: string[],
  rows: TableCell[][],
  widths: ContentTable['table']['widths'],
): ContentTable {
  return {
    table: {
      headerRows: 1,
      keepWithHeaderRows: 1,
      widths,
      body: [
        headers.map((label) => ({ text: label, bold: true, fillColor: '#edf3f0', color: INK })),
        ...rows,
      ],
      dontBreakRows: true,
    },
    layout: {
      hLineWidth: () => 0.5,
      vLineWidth: () => 0,
      hLineColor: () => '#dce6e1',
      paddingLeft: () => 6,
      paddingRight: () => 6,
      paddingTop: () => 6,
      paddingBottom: () => 6,
    },
    fontSize: 9,
    margin: [0, 0, 0, 8],
  };
}

/** Pure definition builder: useful for deterministic tests and offline artifact verification. */
export function appointmentPdfDefinition(input: AppointmentPdfInput): TDocumentDefinitions {
  validatePdfInput(input);
  const { records: data } = input;
  const sources = pdfSources(data);
  const sourceNumbers = new Map(sources.map((source, index) => [refKey(source), index + 1]));
  const source = (ref: SourceRef) => `[${sourceNumbers.get(refKey(ref))}] p.${ref.page + 1}`;
  const seriesCount = data.domains.reduce(
    (n, domain) => n + domain.charts.reduce((sum, chart) => sum + chart.series.length, 0),
    0,
  );
  const readingsCount = data.domains
    .flatMap((d) => d.charts.flatMap((c) => c.series))
    .reduce((n, item) => n + item.points.length, 0);
  const content: Content[] = [
    {
      text: 'CARRYOVER / APPOINTMENT RECORD',
      fontSize: 10,
      bold: true,
      color: TEAL,
      margin: [0, 0, 0, 10],
    },
    { text: 'My results over time', style: 'title', margin: [0, 0, 0, 8] },
    {
      text: `Prepared ${pdfDate(input.preparedAt)} (UTC). Dates in this record use YYYY-MM-DD.`,
      style: 'muted',
      margin: [0, 0, 0, 10],
    },
    {
      text: 'Organized source records for a conversation with your doctor. This record does not diagnose, interpret results or recommend treatment.',
      margin: [0, 0, 0, 8],
    },
  ];
  if (input.fictional)
    content.push({
      text: 'FICTIONAL SAMPLE - All values and source documents are invented. This is not a real medical record.',
      bold: true,
      color: TEAL,
      fillColor: '#edf3f0',
      margin: [0, 4, 0, 10],
    });
  content.push(
    {
      text: `${seriesCount} tests | ${readingsCount} plotted readings | ${data.textResults.length} written results | ${data.warnings.length} unresolved readings`,
      bold: true,
      margin: [0, 0, 0, 7],
    },
    {
      text: `Included groups: ${data.domains.map((d) => text(d.label)).join(', ') || 'none selected'}.`,
      margin: [0, 0, 0, 7],
    },
    {
      text: 'This is a selected snapshot, not a complete medical history. Text recognition and matching can be wrong. Bring original records where possible. Checked labels mean the user compared a reading with its source; they do not represent a clinician review.',
      style: 'muted',
      margin: [0, 0, 0, 8],
    },
    {
      text: `Matching status at export: ${matchingStatus(data.model.state)}.${data.model.waiting ? ` ${data.model.waiting} item(s) waiting.` : ''} ${text(data.model.message)}`,
      style: 'muted',
      margin: [0, 0, 0, 8],
    },
  );
  if (input.questions.trim())
    content.push(heading('Questions I want to ask'), {
      text: text(input.questions),
      margin: [0, 0, 0, 10],
    });
  if (data.warnings.length) {
    content.push(heading(`Readings to check (${data.warnings.length})`), {
      text: 'These readings are not plotted. An unresolved reading is not a statement that it is medically abnormal.',
      style: 'muted',
      margin: [0, 0, 0, 7],
    });
    content.push(
      table(
        ['Reading / date', 'Result as read', 'Why it needs checking / source'],
        data.warnings.map((warning) => [
          `${text(warning.printedName)}\n${pdfDate(warning.date)}`,
          `${text(warning.printedValue)} ${text(warning.printedUnit)}`,
          `${text(warning.detail)}\n${source(warning)}`,
        ]),
        ['*', 98, '*'],
      ),
    );
  }
  for (const domain of data.domains) {
    let firstInDomain = true;
    for (const chart of domain.charts)
      for (const series of chart.series) {
        const rows = [...series.points].sort(
          (a, b) => a.date.localeCompare(b.date) || a.observationId.localeCompare(b.observationId),
        );
        const chartBlock: Content = {
          unbreakable: true,
          stack: [
            ...(firstInDomain ? [heading(text(domain.label))] : []),
            {
              text: `${text(series.label)} (${text(series.unit)})`,
              style: 'test',
              margin: [0, 9, 0, 3],
            },
            {
              text: `Names on source reports: ${series.printedNames.map(text).join(', ')}`,
              style: 'muted',
              margin: [0, 0, 0, 6],
            },
            chartGraphic(series),
          ],
        };
        const readingTable = table(
          ['Collection date', `Result (${text(series.unit)})`, 'Source reading / check', 'Source'],
          rows.map((point) => [
            pdfDate(point.date),
            { text: pdfValue(point), bold: true },
            `${text(point.printedName)}: ${text(point.printedValue)} ${text(point.printedUnit)}${point.conversion ? '\nUnit converted for this chart.' : ''}${point.confirmed ? '\nChecked against source by user.' : '\nExtracted; not yet checked by user.'}${point.printedReference ? `\nPrinted reference: ${text(point.printedReference)}` : ''}`,
            [source(point), ...point.alsoIn.map(source)].join('\n'),
          ]),
          [78, 88, '*', 51],
        );
        if (rows.length <= 6 && JSON.stringify([chartBlock, readingTable]).length < 15000)
          content.push({ unbreakable: true, stack: [chartBlock, readingTable] });
        else content.push(chartBlock, readingTable);
        firstInDomain = false;
      }
  }
  if (data.textResults.length) {
    content.push(heading('Written results'));
    content.push(
      table(
        ['Test / date', 'Result as read', 'Source'],
        data.textResults.map((item) => [
          `${text(item.label)}\n${text(item.printedName)}\n${pdfDate(item.date)}`,
          `${text(item.printedValue)}${item.confirmed ? '\nChecked against source by user.' : '\nExtracted; not yet checked by user.'}`,
          source(item),
        ]),
        ['*', '*', 60],
      ),
    );
  }
  content.push({
    unbreakable: true,
    stack: [
      heading('How to read this record'),
      {
        text: 'Each chart shows one test in the stated unit. Dates are calendar dates and do not shift with your time zone. Hollow markers and <, >, ≤, ≥ indicate reported limits, not exact measurements. Lines connect recorded observations and do not predict values between tests. Tables retain the source reading and mark unit conversions. Duplicate copies are listed as additional sources.',
        style: 'muted',
      },
    ],
  });
  const bibliography: Content[] = [heading('Source bibliography')];
  if (sources.length)
    bibliography.push(
      table(
        ['Reference', 'Saved document', 'Page'],
        sources.map((ref, index) => [
          `[${index + 1}]`,
          text(ref.documentName),
          String(ref.page + 1),
        ]),
        [55, '*', 40],
      ),
    );
  else bibliography.push({ text: 'No source pages in this selection.', style: 'muted' });
  bibliography.push({
    text: 'This PDF contains health information. Store it somewhere you trust and share it only with people you choose. It is self-contained and can be read without an internet connection; the original page images are not embedded.',
    style: 'muted',
    margin: [0, 12, 0, 0],
  });
  content.push({ stack: bibliography, unbreakable: sources.length <= 8 });
  const prepared = new Date(input.preparedAt);
  return {
    info: {
      title: input.fictional
        ? 'Carryover fictional appointment sample'
        : 'Carryover appointment record',
      author: 'Carryover',
      creator: 'Carryover',
      producer: 'Carryover',
      creationDate: prepared,
      modDate: prepared,
    },
    language: 'en-GB',
    pageSize: 'A4',
    pageMargins: [44, 42, 44, 44],
    compress: true,
    defaultStyle: { font: 'Roboto', fontSize: 10, color: INK, lineHeight: 1.2 },
    styles: {
      title: { fontSize: 25, bold: true, color: INK },
      section: { fontSize: 16, bold: true, color: TEAL },
      test: { fontSize: 12, bold: true },
      muted: { fontSize: 9, color: GREY },
    },
    footer: (page, pages) => {
      if (pages > PDF_LIMITS.pages)
        throw new Error(
          'This selection would make more than 100 PDF pages. Choose fewer groups. No partial PDF was saved.',
        );
      return {
        columns: [
          {
            text: input.fictional
              ? 'Carryover - fictional sample'
              : 'Carryover - appointment record',
            alignment: 'left',
          },
          { text: `${page} / ${pages}`, alignment: 'right' },
        ],
        margin: [44, 12, 44, 0],
        fontSize: 8,
        color: GREY,
      };
    },
    content,
  };
}

import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { errorMessage } from '../core/errors';
import { LocalHistory } from '../core/local-history';
import { progressText, ResultsService } from '../core/results.service';
import { DEMO_RECORDS, DEMO_RESULTS, DEMO_SOURCE_PAGES, demoPage } from '../core/demo-data';
import {
  RecordChart,
  RecordPoint,
  RecordSeries,
  RecordsResponse,
  RecordWarning,
  SourceRef,
  TextResult,
  WarningReason,
} from '@shared/records';
import { DOMAINS } from '@shared/catalogue';
import { Observation, ResultsResponse } from '@shared/results';
import { StepRail } from '../shell/step-rail';
import { Icon } from '../ui/icon';
import { formatUnit, LineChart, PointPick } from './line-chart';
import { calendarTimestamp } from './calendar-date';
import { SourceDialog } from './source-dialog';
import { DemoDocuments } from './demo-documents';
import { InfoTip } from './info-tip';
import { ScrollSheet } from './scroll-sheet';
import { SparkLine } from './spark';
import {
  Column,
  formatReference,
  HeadCell,
  layoutColumns,
  parseRange,
  printChunks,
  rangeNote,
  Spark,
  sparkline,
  splitDecimal,
  TrendPoint,
} from './table-layout';

const REASON: Record<WarningReason, string> = {
  unrecognised: 'Not recognised',
  'not-a-test': 'Not a test',
  implausible: 'Check reading',
  unit: 'Unit',
  'no-date': 'No date',
  model: 'Needs checking',
};

/** One value in the cumulative table, exactly as it will be shown and opened. */
interface Cell {
  text: string;
  /** The number split at its decimal point, for alignment; null for words. */
  parts: { int: string; frac: string } | null;
  flag: 'high' | 'low' | 'abnormal' | null;
  /** Dated by another printed date, because the report does not print the collection date. */
  dated: string | null;
  title: string;
  /** "Document name, page 2", for the list of values on small screens. */
  source: string;
  open: () => void;
}
/** One test: a row of the panel's table, newest date first. */
export interface PanelRow {
  key: string;
  label: string;
  unit: string;
  /** The latest report's printed range, with one decimal point and a range dash. */
  reference: string;
  printedAs: string;
  /** Values by date (YYYY-MM-DD; '' for a written result with no date). */
  cells: Partial<Record<string, Cell[]>>;
  /** Dated values (or amounts, for results in words), for the trend line. */
  trend: TrendPoint[];
  /** The latest printed range as numbers, when it is two-sided and in the series unit. */
  band: { lo: number; hi: number } | null;
  /** Set once the panel's time span is known. */
  spark: Spark | null;
  /** Why a flagged value can sit inside the band: earlier reports printed other ranges. */
  rangeNote: string | null;
  /** Values the lab flagged (H, L or abnormal), and the date of the last one. */
  flagged: number;
  lastFlagged: string | null;
  /** The newest date with a value, for the card view. */
  latestDate: string | null;
  chart: RecordChart | null;
}
/** A panel, laid out like a cumulative lab report. */
export interface Panel {
  key: string;
  label: string;
  dates: string[];
  /** Date columns grouped by year, with markers for years with no tests. */
  columns: Column[];
  head: HeadCell[];
  /** The date columns split into tables that fit across a printed A4 page. */
  print: { columns: Column[]; head: HeadCell[] }[];
  rows: PanelRow[];
  /** Whether any value is dated by a date other than collection. */
  approximate: boolean;
  flagged: number;
  /** The widest decimal part, in characters, so every column aligns on the point. */
  frac: number;
  /** First and last year with a dated value. */
  from: string;
  to: string;
}

/** Each test over time, from every lab and language, each value traceable to its page. */
@Component({
  selector: 'app-results',
  imports: [
    DatePipe,
    NgTemplateOutlet,
    RouterLink,
    Icon,
    StepRail,
    LineChart,
    SourceDialog,
    DemoDocuments,
    SparkLine,
    ScrollSheet,
    InfoTip,
  ],
  templateUrl: './results.page.html',
  styleUrl: './results.page.css',
})
export class ResultsPage implements OnInit, OnDestroy {
  private readonly api = inject(ResultsService);
  private readonly history = inject(LocalHistory);
  protected readonly progressText = progressText;
  protected readonly processing = this.api.processing;
  private request = 0;
  private readonly router = inject(Router);
  protected readonly demo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly refreshing = signal(false);
  private destroyed = false;
  private readonly sourceDialog = viewChild.required(SourceDialog);

  protected readonly data = signal<RecordsResponse | null>(null);
  protected readonly raw = signal<ResultsResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly reasonLabel = REASON;
  protected readonly calendarDate = calendarTimestamp;
  /** Show only tests with at least one value the lab flagged. */
  protected readonly flaggedOnly = signal(false);
  /** The test whose every value is listed, on small screens. */
  protected readonly openCard = signal<string | null>(null);

  /** Panels as cumulative tables: numbers and results in words, narrowed by the search box. */
  protected readonly panels = computed<Panel[]>(() => {
    const data = this.data();
    if (!data) return [];
    const q = this.query().trim().toLowerCase();
    const flaggedOnly = this.flaggedOnly();
    const rows = new Map<string, PanelRow[]>();
    const add = (domain: string, row: PanelRow) =>
      rows.set(domain, [...(rows.get(domain) ?? []), row]);
    for (const domain of data.domains)
      for (const chart of domain.charts)
        for (const series of chart.series) add(domain.key, this.seriesRow(series, chart));
    const words = new Map<string, TextResult[]>();
    for (const t of data.textResults) words.set(t.key, [...(words.get(t.key) ?? []), t]);
    for (const list of words.values()) {
      const row = this.wordsRow(list);
      // A test printed both as numbers and as words is one row.
      const same = rows.get(list[0].domain)?.find((r) => r.key === row.key);
      if (!same) add(list[0].domain, row);
      else
        for (const [date, cells] of Object.entries(row.cells))
          (same.cells[date] ??= []).push(...cells!);
    }
    return DOMAINS.flatMap(({ key, label }) => {
      const list = (rows.get(key) ?? []).filter(
        (r) =>
          (!q || r.label.toLowerCase().includes(q) || r.printedAs.toLowerCase().includes(q)) &&
          (!flaggedOnly || r.flagged > 0),
      );
      if (!list.length) return [];
      const dates = [...new Set(list.flatMap((r) => Object.keys(r.cells)))].sort((a, b) =>
        !a ? 1 : !b ? -1 : b.localeCompare(a),
      );
      const all = list.flatMap((r) => Object.values(r.cells).flatMap((cells) => cells ?? []));
      const approximate = all.some((c) => c.dated);
      const frac = Math.max(0, ...all.map((c) => c.parts?.frac.length ?? 0));
      const times = dates.filter(Boolean).map(calendarTimestamp);
      const t0 = Math.min(...times);
      const t1 = Math.max(...times);
      for (const row of list) {
        row.spark =
          times.length && row.trend.length > 1 ? sparkline(row.trend, row.band, t0, t1) : null;
        row.latestDate = dates.find((d) => row.cells[d]?.length) ?? null;
      }
      const year = (t: number) => (Number.isFinite(t) ? String(new Date(t).getUTCFullYear()) : '');
      return [
        {
          key,
          label,
          dates,
          ...layoutColumns(dates),
          print: printChunks(dates),
          rows: list,
          approximate,
          flagged: list.reduce((n, r) => n + r.flagged, 0),
          frac,
          from: year(t0),
          to: year(t1),
        },
      ];
    });
  });
  /** Values the lab flagged across the panels shown. */
  protected readonly flaggedTotal = computed(() =>
    this.panels().reduce((n, p) => n + p.flagged, 0),
  );
  protected readonly expanded = signal<string | null>(null);
  /** Tests that have only results in words. */
  protected readonly textTests = computed(
    () => new Set(this.data()?.textResults.map((t) => t.key)).size,
  );

  private seriesRow(series: RecordSeries, chart: RecordChart): PanelRow {
    const cells: PanelRow['cells'] = {};
    for (const point of series.points) {
      const same = cells[point.date]?.find((c) =>
        c.title.startsWith(`${point.printedName}: ${point.printedValue} `),
      );
      // The same printed value on the same date in two documents is shown once.
      if (same) {
        same.title += ' (also printed in another document)';
        continue;
      }
      const text = point.conversion
        ? `${point.comparator ?? ''}${Number(point.value.toPrecision(4)).toLocaleString('en-GB')}`
        : cleanValue(point.printedValue);
      (cells[point.date] ??= []).push({
        text,
        parts: splitDecimal(text),
        flag: flagOf(point.flag),
        dated: approximate(point.dateKind),
        title: `${point.printedName}: ${point.printedValue} ${point.printedUnit ?? ''}${datedNote(point.dateKind)}`,
        source: `${point.documentName}, page ${point.page + 1}`,
        open: () => this.openPoint({ series, point }),
      });
    }
    const latest = series.points.at(-1);
    // A converted value's printed range is in another unit, so it cannot be drawn.
    const band =
      latest?.printedReference && !latest.conversion ? parseRange(latest.printedReference) : null;
    const flagged = Object.values(cells).flatMap((list) => list!.filter((c) => c.flag));
    const lastFlagged = series.points.filter((p) => flagOf(p.flag)).at(-1)?.date ?? null;
    return {
      key: series.key,
      label: series.label,
      unit: formatUnit(series.unit),
      reference: formatReference(latest?.printedReference ?? ''),
      printedAs: printedNames(series.printedNames),
      cells,
      trend: series.points.map((p) => ({
        t: calendarTimestamp(p.date),
        v: p.value,
        flagged: flagOf(p.flag) !== null,
      })),
      band,
      spark: null,
      rangeNote: rangeNote(
        series.points
          .filter((p) => !p.conversion)
          .map((p) => ({
            date: p.date,
            value: p.value,
            reference: p.printedReference,
            flagged: flagOf(p.flag) === 'high' || flagOf(p.flag) === 'low',
          })),
        band,
      ),
      flagged: flagged.length,
      lastFlagged,
      latestDate: null,
      chart: series.points.length > 1 ? { ...chart, series: [series] } : null,
    };
  }

  private wordsRow(list: TextResult[]): PanelRow {
    const cells: PanelRow['cells'] = {};
    for (const t of list)
      (cells[t.date ?? ''] ??= []).push({
        text: t.english ?? t.printedValue,
        parts: null,
        flag: null,
        dated: approximate(t.dateKind),
        title: `${t.printedName}: ${t.printedValue}${datedNote(t.dateKind)}`,
        source: `${t.documentName}, page ${t.page + 1}`,
        open: () => this.openText(t),
      });
    const dated = list.filter((t) => t.date).sort((a, b) => a.date!.localeCompare(b.date!));
    return {
      key: list[0].key,
      label: list[0].label,
      unit: '',
      reference: '',
      printedAs: printedNames(list.map((t) => t.printedName)),
      cells,
      trend: dated.every((t) => t.level !== null)
        ? dated.map((t) => ({ t: calendarTimestamp(t.date!), v: t.level!, flagged: false }))
        : [],
      band: null,
      spark: null,
      rangeNote: null,
      flagged: 0,
      lastFlagged: null,
      latestDate: null,
      chart: null,
    };
  }

  /** When the page was opened, for the printed copy. */
  protected readonly exportedOn = new Date();

  /**
   * Print this page as it is, laid out for A4 by the print styles; "Save as PDF" in the print
   * dialog makes the file. The page title is the file's suggested name.
   */
  protected exportPdf() {
    const title = document.title;
    const now = new Date();
    const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((n) => String(n).padStart(2, '0'))
      .join('-');
    document.title = `Carryover results ${day}`;
    window.addEventListener('afterprint', () => (document.title = title), { once: true });
    window.print();
  }

  protected toggle(row: PanelRow) {
    this.expanded.update((key) => (key === row.key ? null : row.key));
  }

  protected toggleCard(row: PanelRow) {
    this.openCard.update((key) => (key === row.key ? null : row.key));
  }

  /** "2015–2018" → "2015–18", so the gap column's vertical label stays short. */
  protected shortYears(label: string): string {
    return label.replace(/^(\d{2})(\d{2})–\1(\d{2})$/, '$1$2–$3');
  }

  /** Whether the lab flagged any value in a table cell. */
  protected flaggedCell(cells: Cell[] | undefined): boolean {
    return !!cells?.some((c) => c.flag);
  }

  protected readonly docNames = computed(
    () => new Map((this.raw()?.documents ?? []).map((d) => [d.id, d.name])),
  );

  /** Every row the extractor read, for checking: sorted by name, then date. */
  protected readonly rawRows = computed(() =>
    [...(this.raw()?.observations ?? [])].sort(
      (a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        (a.date ?? '').localeCompare(b.date ?? ''),
    ),
  );

  async ngOnInit() {
    if (this.demo) {
      this.data.set(DEMO_RECORDS);
      this.raw.set(DEMO_RESULTS);
      return;
    }
    await this.refresh();
  }

  private current(request: number) {
    return !this.destroyed && request === this.request;
  }

  protected async refresh(retryModel = false) {
    if (this.demo || this.destroyed || this.refreshing()) return;
    const request = ++this.request;
    this.refreshing.set(true);
    this.error.set(null);
    this.data.set(null);
    this.raw.set(null);
    try {
      const data = await (retryModel ? this.api.retryRecords() : this.api.records());
      if (!this.current(request)) return;
      const raw = await this.history.results();
      if (!this.current(request)) return;
      this.raw.set(raw);
      this.data.set(data);
    } catch (e) {
      if (this.current(request)) this.error.set(errorMessage(e));
    } finally {
      if (this.current(request)) this.refreshing.set(false);
    }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.request++;
  }

  protected span(from: string | null, to: string | null): string {
    if (!from || !to) return '–';
    const a = from.slice(0, 4);
    const b = to.slice(0, 4);
    return a === b ? a : `${a}–${b}`;
  }

  protected anchor(key: string) {
    return this.router.url.split('#')[0] + '#' + key;
  }

  /** Scroll to a group of charts without changing the route. */
  protected jump(key: string) {
    const target = document.getElementById(key);
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
      block: 'start',
    });
  }

  protected unit(u: string): string {
    return formatUnit(u);
  }

  protected openPoint({ series, point }: PointPick) {
    const value = point.conversion
      ? `${point.comparator ?? ''}${Number(point.value.toPrecision(4))} ${formatUnit(series.unit)} (printed ${point.printedValue} ${point.printedUnit ?? ''})`
      : `${point.printedValue} ${point.printedUnit ?? ''}`;
    this.open(
      point,
      series.label,
      `${value} · ${new Date(calendarTimestamp(point.date)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    );
  }

  protected openText(t: TextResult) {
    this.open(t, t.label, `${t.printedValue}${t.date ? ' · ' + t.date : ''}`);
  }

  protected openWarning(w: RecordWarning) {
    this.open(w, w.printedName, `${w.printedValue} ${w.printedUnit ?? ''} · ${w.detail}`);
  }

  protected openRaw(o: Observation) {
    this.open(
      {
        observationId: o.id,
        documentId: o.documentId,
        documentName: this.docNames().get(o.documentId) ?? 'Document',
        page: o.page,
        bbox: o.bbox,
      },
      o.name,
      `${o.valueText} ${o.unit ?? ''}${o.refText ? ' · reference ' + o.refText : ''}`,
    );
  }

  private open(ref: SourceRef, title: string, detail: string) {
    if (this.destroyed) return;
    void this.sourceDialog().open({
      documentId: ref.documentId,
      documentName: ref.documentName,
      page: ref.page,
      bbox: ref.bbox,
      title,
      detail,
      observation: this.raw()?.observations.find(
        (o) => o.id === ref.observationId && o.documentId === ref.documentId,
      ),
      demoText: this.demo
        ? (DEMO_SOURCE_PAGES[ref.documentId]?.[ref.page] ?? 'Fictional source text is unavailable.')
        : undefined,
      demoImage: this.demo ? demoPage(ref.documentId, ref.page) : undefined,
    });
  }

  /** For a value or range corrected after text recognition: what was read, for the cell's title. */
  protected fixNote(o: Observation, field: 'value' | 'range'): string | null {
    const fix = o.ocrFixes?.find((f) => f.field === field);
    return fix
      ? `Text recognition read “${fix.read}”. A decimal adjustment was proposed by text recognition; open the source to check it.`
      : null;
  }
}

/** "TSH (ICD-9: L69)" → "TSH": lab codes add nothing to "printed as". */
function cleanPrinted(name: string): string {
  return name.replace(/\s*\(ICD[^)]*\)?/gi, '').trim();
}

/** The printed names merged into a test, without repeats or lab codes; the first few. */
function printedNames(names: string[]): string {
  const seen = new Map<string, string>();
  for (const name of names.map(cleanPrinted)) {
    const key = name.toLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
  }
  const all = [...seen.values()];
  const shown = all.slice(0, 4).join(', ');
  return all.length > 4 ? `${shown} and ${all.length - 4} more` : shown;
}

/**
 * "12,9*" → "12.9": one decimal point for every lab, and no accreditation asterisk. The
 * digits stay as printed; the cell's title shows the original.
 */
function cleanValue(value: string): string {
  return value.replace(/\s*\*+$/, '').replace(/(\d),(\d)/g, '$1.$2');
}

const DATED: Record<string, string> = {
  received: 'the sample was received',
  performed: 'the test was performed',
  registered: 'the test was registered',
  reported: 'the result was issued',
};
/** A received sample is collected the same day; later dates are marked in the table. */
function approximate(kind: string | null): string | null {
  return kind && kind !== 'received' ? kind : null;
}
function datedNote(kind: string | null): string {
  return kind ? ` (dated by when ${DATED[kind] ?? kind}; the collection date is not printed)` : '';
}

function flagOf(flag: RecordPoint['flag']): Cell['flag'] {
  if (flag === 'H' || flag === 'HH') return 'high';
  if (flag === 'L' || flag === 'LL') return 'low';
  return flag === 'A' ? 'abnormal' : null;
}

import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, computed, effect, inject, OnDestroy, OnInit, signal, untracked, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { describeHttpError } from '../core/document-queue.service';
import { DocumentsApi } from '../core/documents-api';
import { DEMO_RECORDS, DEMO_RESULTS, DEMO_SOURCE_PAGES } from '../core/demo-data';
import { RecordDomain, RecordsResponse, RecordWarning, SourceRef, TextResult, WarningReason } from '../core/records';
import { Observation, ResultsResponse } from '../core/results';
import { StepRail } from '../shell/step-rail';
import { Icon } from '../ui/icon';
import { formatUnit, LineChart, PointPick } from './line-chart';
import { calendarTimestamp } from './calendar-date';
import { SourceDialog } from './source-dialog';
import { RecoveryPanel } from './recovery-panel';
import { AuthService } from '../auth/auth.service';

const REASON: Record<WarningReason, string> = {
  unrecognised: 'Not recognised',
  'not-a-test': 'Not a test',
  implausible: 'Check reading',
  unit: 'Unit',
  'no-date': 'No date',
  model: 'Needs checking',
};

/** While Muse Spark works in the background, check back this often. */
const POLL_MS = 4000;
const MAX_POLLS = 45;

/** Each test over time, from every lab and language, each value traceable to its page. */
@Component({
  selector: 'app-results',
  imports: [DatePipe, DecimalPipe, RouterLink, Icon, StepRail, LineChart, SourceDialog, RecoveryPanel],
  templateUrl: './results.page.html',
  styles: `
    /* A value corrected after text recognition: dotted underline, details in the title. */
    .fixed {
      text-decoration: underline dotted var(--color-warning);
      text-underline-offset: 4px;
      cursor: help;
    }
  `,
})
export class ResultsPage implements OnInit, OnDestroy {
  private readonly api = inject(DocumentsApi);
  private readonly auth = inject(AuthService);
  private session = this.auth.sessionRevision();
  private request = 0;
  private readonly router = inject(Router);
  protected readonly demo = inject(ActivatedRoute).snapshot.data['demo'] === true;
  protected readonly paused = signal(false);
  protected readonly refreshing = signal(false);
  private destroyed = false;
  private readonly sourceDialog = viewChild.required(SourceDialog);
  private poll: ReturnType<typeof setTimeout> | null = null;
  private polls = 0;

  protected readonly data = signal<RecordsResponse | null>(null);
  protected readonly raw = signal<ResultsResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly reasonLabel = REASON;
  protected readonly calendarDate = calendarTimestamp;

  /** Domains and charts, narrowed by the search box (test names, printed names). */
  protected readonly domains = computed<RecordDomain[]>(() => {
    const q = this.query().trim().toLowerCase();
    const all = this.data()?.domains ?? [];
    if (!q) return all;
    return all
      .map((d) => ({
        ...d,
        charts: d.charts
          .map((c) => ({ ...c, series: c.series.filter((s) => [s.label, ...s.printedNames].some((n) => n.toLowerCase().includes(q))) }))
          .filter((c) => c.series.length),
      }))
      .filter((d) => d.charts.length);
  });

  /** Per domain: charts for tests with two or more values, a short list for tests measured once. */
  protected readonly sections = computed(() =>
    this.domains().map((d) => ({
      key: d.key,
      label: d.label,
      charts: d.charts.map((c) => ({ ...c, series: c.series.filter((s) => s.points.length > 1) })).filter((c) => c.series.length),
      once: d.charts.flatMap((c) => c.series.filter((s) => s.points.length === 1).map((s) => ({ series: s, point: s.points[0] }))),
    })),
  );

  protected readonly textResults = computed(() => {
    const q = this.query().trim().toLowerCase();
    return (this.data()?.textResults ?? []).filter((t) => !q || t.label.toLowerCase().includes(q) || t.printedName.toLowerCase().includes(q));
  });

  protected readonly docNames = computed(() => new Map((this.raw()?.documents ?? []).map((d) => [d.id, d.name])));

  /** Every row the extractor read, for checking: sorted by name, then date. */
  protected readonly rawRows = computed(() =>
    [...(this.raw()?.observations ?? [])].sort(
      (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || (a.date ?? '').localeCompare(b.date ?? ''),
    ),
  );

  async ngOnInit() {
    if (this.demo) { this.data.set(DEMO_RECORDS); this.raw.set(DEMO_RESULTS); return; }
    await this.refresh();
  }

  constructor() {
    effect(() => {
      const session = this.auth.sessionRevision();
      if (session === this.session) return;
      this.session = session;
      untracked(() => {
        this.request++;
        if (this.poll) clearTimeout(this.poll);
        this.data.set(null); this.raw.set(null); this.query.set(''); this.error.set(null);
        this.refreshing.set(false); this.paused.set(false); this.polls = 0;
        if (this.demo) { this.data.set(DEMO_RECORDS); this.raw.set(DEMO_RESULTS); }
        else if (this.auth.userId()) void this.refresh();
      });
    });
  }

  private current(request: number, owner: string | null, session: number) {
    return !this.destroyed && request === this.request && owner === this.auth.userId() && session === this.auth.sessionRevision();
  }

  protected async refresh(retryModel = false) {
    const owner = this.auth.userId(), session = this.auth.sessionRevision();
    if (this.demo || !owner || this.destroyed || this.refreshing()) return;
    const request = ++this.request;
    if (this.poll) clearTimeout(this.poll);
    this.polls = 0; this.paused.set(false); this.refreshing.set(true);
    try {
      if (retryModel) await this.api.retryRecords();
      if (!this.current(request, owner, session)) return;
      const raw = await this.api.results();
      if (!this.current(request, owner, session)) return;
      this.raw.set(raw);
      await this.load(request, owner, session);
    } catch (e) { if (this.current(request, owner, session)) this.error.set(describeHttpError(e)); }
    finally { if (this.current(request, owner, session)) this.refreshing.set(false); }
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.request++;
    if (this.poll) clearTimeout(this.poll);
  }

  private async load(request: number, owner: string, session: number) {
    if (!this.current(request, owner, session)) return;
    try {
      const data = await this.api.records();
      if (!this.current(request, owner, session)) return;
      this.data.set(data);
      this.error.set(null);
      if (data.model.state === 'working' && this.polls++ < MAX_POLLS) {
        this.poll = setTimeout(() => void this.load(request, owner, session), POLL_MS);
      } else if (data.model.state === 'working') { this.paused.set(true); }
    } catch (e) {
      if (this.current(request, owner, session)) this.error.set(describeHttpError(e));
    }
  }

  protected chartTitle(chart: RecordDomain['charts'][number]): string {
    return chart.series.map((s) => s.label).join(' · ');
  }

  protected span(from: string | null, to: string | null): string {
    if (!from || !to) return '–';
    const a = from.slice(0, 4);
    const b = to.slice(0, 4);
    return a === b ? a : `${a}–${b}`;
  }

  protected anchor(key: string) { return this.router.url.split('#')[0] + '#' + key; }

  /** Scroll to a group of charts without changing the route. */
  protected jump(key: string) {
    const target = document.getElementById(key);
    if (!target) return;
    target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    target.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }

  /** The names merged into the chart's tests, as printed, without repeats or lab codes; the first few. */
  protected printedAs(chart: RecordDomain['charts'][number]): string {
    const seen = new Map<string, string>();
    for (const name of chart.series.flatMap((s) => s.printedNames.map(cleanPrinted))) {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    const names = [...seen.values()];
    const shown = names.slice(0, 6).join(', ');
    return names.length > 6 ? `${shown} and ${names.length - 6} more` : shown;
  }

  protected unit(u: string): string {
    return formatUnit(u);
  }

  protected openPoint({ series, point }: PointPick) {
    const value = point.conversion
      ? `${point.comparator ?? ''}${Number(point.value.toPrecision(4))} ${formatUnit(series.unit)} (printed ${point.printedValue} ${point.printedUnit ?? ''})`
      : `${point.printedValue} ${point.printedUnit ?? ''}`;
    this.open(point, series.label, `${value} · ${new Date(calendarTimestamp(point.date)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
  }

  protected openText(t: TextResult) {
    this.open(t, t.label, `${t.printedValue}${t.date ? ' · ' + t.date : ''}`);
  }

  protected openWarning(w: RecordWarning) {
    this.open(w, w.printedName, `${w.printedValue} ${w.printedUnit ?? ''} · ${w.detail}`);
  }

  protected openRaw(o: Observation) {
    this.open(
      { observationId: o.id, documentId: o.documentId, documentName: this.docNames().get(o.documentId) ?? 'Document', page: o.page, bbox: o.bbox },
      o.name,
      `${o.valueText} ${o.unit ?? ''}${o.refText ? ' · reference ' + o.refText : ''}`,
    );
  }

  private open(ref: SourceRef, title: string, detail: string) {
    if (!this.demo && (this.auth.sessionRevision() !== this.session || !this.auth.userId())) return;
    void this.sourceDialog().open({ documentId: ref.documentId, documentName: ref.documentName, page: ref.page, bbox: ref.bbox, title, detail,
      observation: this.raw()?.observations.find((o) => o.id === ref.observationId && o.documentId === ref.documentId),
      demoText: this.demo ? DEMO_SOURCE_PAGES[ref.documentId]?.[ref.page] ?? 'Fictional source text is unavailable.' : undefined });
  }

  /** For a value or range corrected after text recognition: what was read, for the cell's title. */
  protected fixNote(o: Observation, field: 'value' | 'range'): string | null {
    const fix = o.ocrFixes?.find((f) => f.field === field);
    return fix ? `Text recognition read “${fix.read}”. A decimal adjustment was proposed by text recognition; open the source to check it.` : null;
  }
}

/** "TSH (ICD-9: L69)" → "TSH": lab codes add nothing to "printed as". */
function cleanPrinted(name: string): string {
  return name.replace(/\s*\(ICD[^)]*\)?/gi, '').trim();
}






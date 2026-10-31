import { DatePipe } from '@angular/common';
import { Component, computed, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { DEMO_RECORDS, DEMO_RESULTS, DEMO_SOURCE_PAGES } from '../core/demo-data';
import { errorMessage } from '../core/errors';
import { LocalHistory } from '../core/local-history';
import { ResultsService } from '../core/results.service';
import { RecordDomain, RecordsResponse, SourceRef } from '@shared/records';
import { ResultsResponse } from '@shared/results';
import { LineChart, PointPick } from '../results/line-chart';
import { SourceDialog } from '../results/source-dialog';

export function selectDomains(domains: RecordDomain[], keys: ReadonlySet<string>): RecordDomain[] {
  return domains.filter((domain) => keys.has(domain.key));
}
export function sourceReferences(data: RecordsResponse, domains: RecordDomain[]): SourceRef[] {
  const points = domains.flatMap((d) => d.charts.flatMap((c) => c.series.flatMap((s) => s.points)));
  const refs = [
    ...points,
    ...points.flatMap((p) => p.alsoIn),
    ...data.textResults,
    ...data.warnings,
  ];
  const unique = new Map<string, SourceRef>();
  for (const ref of refs) unique.set(`${ref.documentId}:${ref.page}`, ref);
  return [...unique.values()].sort(
    (a, b) => a.documentName.localeCompare(b.documentName) || a.page - b.page,
  );
}

@Component({
  selector: 'app-appointment',
  imports: [DatePipe, FormsModule, RouterLink, LineChart, SourceDialog],
  templateUrl: './appointment.page.html',
})
export class AppointmentPage implements OnInit, OnDestroy {
  private readonly api = inject(ResultsService);
  private readonly history = inject(LocalHistory);
  private request = 0;
  private destroyed = false;
  private readonly downloads = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly source = viewChild.required(SourceDialog);
  protected readonly demo = inject(ActivatedRoute).snapshot.queryParamMap.get('demo') === 'true';
  protected readonly data = signal<RecordsResponse | null>(null);
  protected readonly raw = signal<ResultsResponse | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly keys = signal<ReadonlySet<string>>(new Set());
  protected readonly selected = computed(() =>
    selectDomains(this.data()?.domains ?? [], this.keys()),
  );
  protected readonly sources = computed(() =>
    this.data() ? sourceReferences(this.data()!, this.selected()) : [],
  );
  protected readonly counts = computed(() => {
    const series = this.selected().flatMap((d) => d.charts.flatMap((c) => c.series));
    return { tests: series.length, values: series.reduce((n, s) => n + s.points.length, 0) };
  });
  protected readonly prepared = new Date();
  protected notes = '';
  protected readonly exporting = signal(false);
  protected readonly exportError = signal<string | null>(null);
  protected readonly exported = signal(false);
  private exportAbort: AbortController | null = null;

  private current(request: number) {
    return !this.destroyed && request === this.request;
  }

  async ngOnInit() {
    await this.load();
  }
  protected async load(preserveSelection = false) {
    if (this.destroyed) return;
    if (this.exporting()) {
      this.clearDownloads();
      this.exporting.set(false);
    }
    const request = ++this.request;
    this.error.set(null);
    this.data.set(null);
    this.raw.set(null);
    try {
      const data = this.demo ? DEMO_RECORDS : await this.api.records();
      if (!this.current(request)) return;
      const raw = this.demo ? DEMO_RESULTS : await this.history.results();
      if (!this.current(request)) return;
      this.data.set(data);
      this.raw.set(raw);
      if (!preserveSelection) this.keys.set(new Set(data.domains.map((d) => d.key)));
    } catch (e) {
      if (this.current(request)) this.error.set(errorMessage(e));
    }
  }
  protected toggle(key: string) {
    const keys = new Set(this.keys());
    if (keys.has(key)) keys.delete(key);
    else keys.add(key);
    this.keys.set(keys);
  }
  protected selectAll() {
    this.keys.set(new Set(this.data()?.domains.map((d) => d.key)));
  }
  protected async downloadPdf() {
    const data = this.data();
    const request = this.request;
    if (!data || this.exporting() || this.destroyed) return;
    this.exporting.set(true);
    this.exportError.set(null);
    this.exported.set(false);
    const controller = (this.exportAbort = new AbortController());
    const input = {
      records: { ...data, domains: this.selected() },
      questions: this.notes,
      preparedAt: this.prepared.toISOString(),
      fictional: this.demo,
    };
    try {
      const { generateAppointmentPdf } = await import('./pdf-download');
      if (!this.current(request)) return;
      const blob = await generateAppointmentPdf(input, controller.signal);
      if (!this.current(request)) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `carryover-appointment-${this.prepared.toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      this.downloads.set(
        url,
        setTimeout(() => {
          URL.revokeObjectURL(url);
          this.downloads.delete(url);
        }, 30_000),
      );
      this.exported.set(true);
    } catch (e) {
      if (this.current(request))
        this.exportError.set(
          e instanceof Error ? e.message : 'Could not make the PDF. Please try again.',
        );
    } finally {
      if (this.current(request)) this.exporting.set(false);
    }
  }

  private clearDownloads() {
    this.exportAbort?.abort();
    this.exportAbort = null;
    for (const [url, timer] of this.downloads) {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
    }
    this.downloads.clear();
  }
  ngOnDestroy() {
    this.destroyed = true;
    this.request++;
    this.clearDownloads();
  }

  protected print() {
    if (this.destroyed) return;
    // A user may collapse a table while browsing; the printed record must still include its values.
    const closed = [
      ...document.querySelectorAll<HTMLDetailsElement>('.appointment .chart-table:not([open])'),
    ];
    closed.forEach((table) => {
      table.open = true;
    });
    window.addEventListener(
      'afterprint',
      () =>
        closed.forEach((table) => {
          table.open = false;
        }),
      { once: true },
    );
    window.print();
  }
  protected openPoint({ series, point }: PointPick) {
    this.open(
      point,
      series.label,
      `${point.printedValue} ${point.printedUnit ?? ''} · ${point.date}`,
    );
  }
  protected open(ref: SourceRef, title: string, detail: string) {
    if (this.destroyed) return;
    void this.source().open({
      ...ref,
      title,
      detail,
      observation: this.raw()?.observations.find(
        (o) => o.id === ref.observationId && o.documentId === ref.documentId,
      ),
      demoText: this.demo
        ? (DEMO_SOURCE_PAGES[ref.documentId]?.[ref.page] ?? 'Fictional source text unavailable.')
        : undefined,
    });
  }
}

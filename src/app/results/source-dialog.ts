import { DatePipe } from '@angular/common';
import { Component, ElementRef, inject, OnDestroy, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { describeHttpError } from '../core/document-queue.service';
import { DocumentsApi } from '../core/documents-api';
import { StoredWord } from '../core/models';
import { Observation } from '../core/results';
import { Icon } from '../ui/icon';

export interface SourceTarget {
  documentId: string;
  documentName: string;
  page: number;
  bbox: [number, number, number, number] | null;
  title: string;
  detail: string;
  observation?: Observation;
  /** Present only for the explicitly labelled, fabricated guest sample. */
  demoText?: string;
}
interface Shown { target: SourceTarget; url: string | null; text: string; width: number; height: number; loading: boolean; error: string | null; }
export interface CorrectionDraft { name: string; valueText: string; unit: string; date: string; note: string; }
export function correctionDraft(o: Observation): CorrectionDraft {
  return { name: o.name, valueText: o.valueText, unit: o.unit ?? '', date: o.date ?? '', note: '' };
}
/** Hidden strings never enter the accessible text version. */
export function sourceText(words: StoredWord[]): string {
  const lines = new Map<number, string[]>();
  for (const w of words) {
    if (!lines.has(w.l)) lines.set(w.l, []);
    lines.get(w.l)!.push(w.h || w.t === null ? '[hidden]' : w.t);
  }
  return [...lines.values()].map((line) => line.join(' ')).join('\n');
}

@Component({
  selector: 'app-source-dialog',
  imports: [Icon, FormsModule, DatePipe],
  template: `
    <dialog #dialog class="modal" (close)="onClose()" (cancel)="onCancel($event)" aria-labelledby="src-h">
      <div class="modal-box max-w-5xl p-0">
        @if (shown(); as s) {
          <header class="flex items-start justify-between gap-4 p-5 border-b border-base-300">
            <div class="min-w-0">
              <h2 id="src-h" class="font-display text-xl font-semibold">{{ s.target.title }}</h2>
              <p class="mt-1 break-words">{{ s.target.detail }}</p>
              <p class="text-sm text-base-content/80 mt-1">{{ s.target.documentName }} · page {{ s.target.page + 1 }}</p>
            </div>
            <button type="button" class="btn btn-ghost btn-circle shrink-0" aria-label="Close source" [disabled]="saving()" (click)="close()"><app-icon name="x" /></button>
          </header>
          <div class="p-4 sm:p-5 space-y-4">
            @if (s.target.demoText !== undefined) { <p class="rounded-box bg-base-200 p-3 text-sm">Fictional sample. This text was created for the demo and is not a person's medical record.</p> }
            @if (s.loading) { <p role="status"><span class="loading loading-spinner loading-sm"></span> Opening the saved page…</p> }
            @if (s.error) { <p role="alert" class="alert alert-error alert-soft">{{ s.error }}</p> }
            @if (s.url) {
              <label class="flex items-center gap-3 text-sm font-medium">Page size
                <select class="select select-bordered w-36" [ngModel]="zoom()" (ngModelChange)="zoom.set(+$event)">
                  <option [ngValue]="100">Fit width</option><option [ngValue]="200">200%</option><option [ngValue]="300">300%</option>
                </select>
              </label>
              <div class="overflow-auto max-h-[50vh] rounded-box border border-base-300" tabindex="0" aria-label="Source page. Scroll to inspect the page.">
                <div class="relative" [style.width.%]="zoom()">
                  <img [src]="s.url" class="block w-full" [alt]="s.target.documentName + ', page ' + (s.target.page + 1) + '. Text version follows.'" />
                  @if (s.target.bbox; as b) {
                    <svg class="absolute inset-0 w-full h-full pointer-events-none" [attr.viewBox]="'0 0 ' + s.width + ' ' + s.height" aria-hidden="true">
                      <rect [attr.x]="b[0]" [attr.y]="b[1]" [attr.width]="b[2]" [attr.height]="b[3]" fill="rgba(255,200,0,.16)" stroke="#0d7a68" stroke-width="3" vector-effect="non-scaling-stroke" />
                    </svg>
                  }
                </div>
              </div>
              <p class="text-sm text-base-content/80">The outlined area is where this reading was found. Check the printed value, unit and date.</p>
            }
            @if (s.text) {
              <details [open]="!s.url" class="rounded-box border border-base-300 p-3">
                <summary class="font-medium cursor-pointer py-1">Text version of this page</summary>
                <p class="text-sm text-base-content/80 my-2">Text recognition can make mistakes. Hidden text is marked [hidden].</p>
                <pre class="whitespace-pre-wrap break-words text-sm max-h-80 overflow-auto" tabindex="0">{{ s.text }}</pre>
              </details>
            } @else if (!s.loading && !s.error && !s.url) { <p>No readable source text is available for this page.</p> }
            @if (s.target.observation; as o) {
              @if (o.transcription; as printed) {
                <details class="rounded-box border border-base-300 p-3">
                  <summary class="font-medium cursor-pointer py-1">Original page transcription</summary>
                  <p>{{ printed.name ?? 'Unreadable test' }} · {{ printed.value ?? 'Unreadable value' }} {{ printed.unit ?? '(unit missing)' }}</p>
                  <p>Reference: {{ printed.reference ?? 'not printed' }} · Flag: {{ printed.flag ?? 'not printed' }}</p>
                  <p>Collected: {{ printed.collectionDate.printed ?? 'not printed' }} · Ordered: {{ printed.orderDate.printed ?? 'not printed' }} · Reported: {{ printed.reportDate.printed ?? 'not printed' }}</p>
                  @if (printed.specimen || printed.method) { <p>{{ printed.specimen }} {{ printed.method }}</p> }
                  @for (issue of printed.uncertainty; track $index) { <p>{{ issue }}</p> }
                </details>
              }
              @if (o.original; as original) {
                <p class="text-sm text-base-content/80"><strong>Original extracted reading:</strong> {{ original.name }} · {{ original.valueText }} {{ original.unit ?? '' }} · {{ original.date ?? 'date unknown' }}. This may contain recognition errors.</p>
              }
              @if (o.corrections?.length) {
                <details class="rounded-box border border-base-300 p-3">
                  <summary class="font-medium cursor-pointer py-1">Checks and corrections ({{ o.corrections!.length }})</summary>
                  <ul class="mt-2 space-y-2 text-sm">
                    @for (c of o.corrections; track $index) {
                      <li><time>{{ c.at | date:'d MMM y, HH:mm' }}</time> · {{ c.note }}<span class="block text-base-content/80">{{ historyChanges(c.changes) }}</span></li>
                    }
                  </ul>
                </details>
              }
              @if (s.target.demoText === undefined && o.revision) {
                @if (!editing()) {
                  <button type="button" class="btn btn-primary rounded-full" [disabled]="s.loading || !!s.error" (click)="startEdit(o)">Check or correct this reading</button>
                } @else {
                  <form class="rounded-box border border-primary/40 bg-base-200 p-4 space-y-4" (ngSubmit)="save()">
                    <h3 class="font-semibold text-lg">Copy what the document says</h3>
                    <p class="text-sm">Confirm the printed name, value, unit and collection date. Leave an unknown unit or date blank. Your original reading and this correction remain available.</p>
                    <div class="grid sm:grid-cols-2 gap-3">
                      <label class="form-control block">Test name<input name="testName" class="input w-full mt-1" [(ngModel)]="form.name" required maxlength="200" /></label>
                      <label class="form-control block">Result, including &lt; or &gt;<input name="value" class="input w-full mt-1" [(ngModel)]="form.valueText" required maxlength="100" /></label>
                      <label class="form-control block">Unit<input name="unit" class="input w-full mt-1" [(ngModel)]="form.unit" maxlength="60" /></label>
                      <label class="form-control block">Collection date<input name="date" type="date" class="input w-full mt-1" [(ngModel)]="form.date" /></label>
                    </div>
                    <label class="block">What did you check or change?<textarea name="note" class="textarea w-full mt-1" [(ngModel)]="form.note" required maxlength="500" placeholder="For example: Checked the value and date against the printed row."></textarea></label>
                    @if (saveError()) { <p role="alert" class="text-error">{{ saveError() }}</p> }
                    <div class="flex flex-wrap gap-2">
                      <button type="submit" class="btn btn-primary rounded-full" [disabled]="saving() || !form.name.trim() || !form.valueText.trim() || !form.note.trim()">{{ saving() ? 'Saving your check…' : 'Save checked reading' }}</button>
                      <button type="button" class="btn btn-ghost rounded-full" [disabled]="saving()" (click)="editing.set(false)">Cancel</button>
                    </div>
                  </form>
                }
              }
            }
          </div>
        }
      </div>
    </dialog>
  `,
})
export class SourceDialog implements OnDestroy {
  private readonly api = inject(DocumentsApi);
  private destroyed = false;
  private readonly dialog = viewChild.required<ElementRef<HTMLDialogElement>>('dialog');
  readonly corrected = output<Observation>();
  protected readonly shown = signal<Shown | null>(null);
  protected readonly zoom = signal(100);
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected form: CorrectionDraft = { name: '', valueText: '', unit: '', date: '', note: '' };

  private current(target: SourceTarget) {
    return !this.destroyed && this.shown()?.target === target;
  }

  async open(target: SourceTarget): Promise<boolean> {
    if (this.destroyed) return false;
    this.release();
    this.editing.set(false); this.saveError.set(null); this.zoom.set(100);
    this.shown.set({ target, url: null, text: target.demoText ?? '', width: 0, height: 0, loading: target.demoText === undefined, error: null });
    if (!this.dialog().nativeElement.open) this.dialog().nativeElement.showModal();
    if (target.demoText !== undefined) return true;
    const current = () => this.current(target);
    try {
      const saved = await this.api.get(target.documentId);
      if (!current()) return false;
      const page = saved.pages.find((p) => p.index === target.page);
      if (!page) throw new Error('The source page is unavailable. Reopen the document and try again.');
      this.shown.update((s) => s && { ...s, text: target.observation?.sourceImage ? '' : sourceText(page.words), width: page.width, height: page.height, loading: page.hasImage });
      if (!page.hasImage) return !!sourceText(page.words).trim();
      const blob = await this.api.pageImage(target.documentId, target.page);
      if (!current()) return false;
      this.shown.update((s) => s && { ...s, url: URL.createObjectURL(blob), loading: false });
      return true;
    } catch (e) {
      if (current()) this.shown.update((s) => s && { ...s, loading: false, error: describeHttpError(e) });
      return false;
    }
  }
  protected startEdit(o: Observation) { this.form = correctionDraft(o); this.editing.set(true); this.saveError.set(null); }
  protected async save() {
    const target = this.shown()?.target;
    const o = target?.observation;
    if (!target || !o?.revision || this.saving() || this.destroyed) return;
    if (!this.form.name.trim() || !this.form.valueText.trim() || !this.form.note.trim()) { this.saveError.set('Enter the test, result and a note describing what you checked.'); return; }
    this.saving.set(true); this.saveError.set(null);
    try {
      const corrected = await this.api.correct(o.documentId, o.id, { name: this.form.name.trim(), valueText: this.form.valueText.trim(), unit: this.form.unit.trim() || null, date: this.form.date || null, note: this.form.note.trim(), expectedRevision: o.revision });
      if (!this.current(target)) return;
      this.corrected.emit(corrected);
      this.saving.set(false); this.close();
    } catch (e) { if (this.current(target)) this.saveError.set(describeHttpError(e)); }
    finally { if (this.current(target)) this.saving.set(false); }
  }
  protected historyChanges(changes: Record<string, unknown>): string {
    const entries = Object.entries(changes);
    return entries.length ? entries.map(([k, v]) => `${k === 'valueText' ? 'result' : k}: ${v ?? 'unknown'}`).join(' · ') : 'Confirmed without changing the reading.';
  }
  close() { if (!this.saving()) this.dialog().nativeElement.close(); }
  protected onCancel(event: Event) { if (this.saving()) event.preventDefault(); }
  ngOnDestroy() { this.destroyed = true; this.clear(); }
  protected onClose() { this.clear(); }
  private clear() {
    this.release(); this.shown.set(null); this.editing.set(false); this.saving.set(false); this.saveError.set(null);
    this.form = { name: '', valueText: '', unit: '', date: '', note: '' };
  }
  private release() { const url = this.shown()?.url; if (url) URL.revokeObjectURL(url); }
}




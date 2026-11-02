import { Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DocumentQueueService } from '../core/document-queue.service';
import { ToastService } from '../core/toast.service';
import { Box, PiiKind, WorkingWord } from '../core/models';
import { redactionPlan } from '../redaction/burn';
import type { Turn } from '../redaction/rotate';

import { KIND_LABEL, KIND_PLURAL } from './describe';
import { EditMode, PageView } from './page-view';
import { TextView } from './text-view';
import { Icon } from '../ui/icon';
import { StepRail } from '../shell/step-rail';
import { StorageNotice } from '../shell/storage-notice';

interface HiddenGroup {
  key: string;
  text: string;
  kind: PiiKind;
  count: number;
  /** One occurrence to toggle; toggling shows every occurrence in turn. */
  refs: { page: number; id: number }[];
  byYou: boolean;
}

@Component({
  selector: 'app-review',
  imports: [PageView, TextView, RouterLink, Icon, StepRail, StorageNotice],
  templateUrl: './review.page.html',
  styleUrl: './review.page.css',
  host: { '(document:keydown)': 'onKeydown($event)' },
})
export class ReviewPage {
  protected readonly queue = inject(DocumentQueueService);

  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly localId = input.required<string>();
  readonly embedded = input(false);

  protected readonly mode = signal<EditMode>('words');
  protected readonly reveal = signal(false);
  protected readonly turning = signal(false);
  /** Every page as lines of word buttons: hiding by keyboard or screen reader, or at large zoom. */
  protected readonly asText = signal(false);

  protected readonly doc = computed(() => this.queue.byId(this.localId()));
  protected readonly busy = computed(() => {
    const s = this.doc()?.status;
    return s === 'detecting' || s === 'saving';
  });
  protected readonly hasImages = computed(() => this.doc()?.pages.some((p) => p.image) ?? false);
  private readonly plannedPages = computed(() =>
    (this.doc()?.pages ?? []).map((page) => ({ page, plan: redactionPlan(page) })),
  );
  protected readonly hiddenCount = computed(() =>
    this.plannedPages().reduce(
      (count, { page, plan }) => count + plan.hidden.size + page.regions.length,
      0,
    ),
  );
  protected readonly candidateCount = computed(() =>
    this.plannedPages().reduce(
      (count, { page, plan }) =>
        count +
        page.words.filter(
          (word, index) => word.candidate && !word.userSet && !plan.hidden.has(index),
        ).length,
      0,
    ),
  );
  protected readonly nearbyCount = computed(() =>
    this.plannedPages().reduce(
      (count, { page, plan }) =>
        count + [...plan.hidden].filter((index) => !page.words[index].hidden).length,
      0,
    ),
  );
  protected readonly lockedCount = computed(
    () =>
      this.doc()?.pages.reduce(
        (n, p) => n + p.words.filter((w) => w.locked).length + (p.lockedRegions ?? 0),
        0,
      ) ?? 0,
  );

  /** Hidden words grouped by text, so "Kowalska" ×4 is one line in the list. */
  protected readonly groups = computed<HiddenGroup[]>(() => {
    const doc = this.doc();
    if (!doc) return [];
    const map = new Map<string, HiddenGroup>();
    doc.pages.forEach((page, p) => {
      for (const w of page.words) {
        if (!w.hidden || w.locked || w.text === null) continue;
        const key = w.text.toLowerCase();
        const g = map.get(key) ?? {
          key,
          text: w.text,
          kind: w.kind ?? 'other',
          count: 0,
          refs: [],
          byYou: false,
        };
        g.count++;
        g.refs.push({ page: p, id: w.id });
        g.byYou ||= w.source === 'you';
        map.set(key, g);
      }
    });
    return [...map.values()];
  });

  /** Hidden words per kind, for the ledger ("names ...... 6"). */
  protected readonly kindRows = computed(() => {
    const counts = new Map<PiiKind, number>();
    for (const g of this.groups()) counts.set(g.kind, (counts.get(g.kind) ?? 0) + g.count);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, n]) => ({ label: n === 1 ? KIND_LABEL[kind] : KIND_PLURAL[kind], n }));
  });

  protected readonly regionCount = computed(
    () => this.doc()?.pages.reduce((n, p) => n + p.regions.length - (p.lockedRegions ?? 0), 0) ?? 0,
  );

  protected readonly kindLabel = KIND_LABEL;
  protected readonly canUndo = computed(() => this.queue.canUndo(this.localId()));
  protected readonly canRedo = computed(() => this.queue.canRedo(this.localId()));

  protected undo() {
    if (!this.busy()) this.queue.undo(this.localId());
  }

  protected redo() {
    if (!this.busy()) this.queue.redo(this.localId());
  }

  /** Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z or Ctrl+Y redoes. Text fields keep their own undo. */
  protected onKeydown(e: KeyboardEvent) {
    if (e.defaultPrevented || e.altKey || !(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    if (!this.ownsShortcut(e.target)) return;
    e.preventDefault();
    if (key === 'y' || e.shiftKey) this.redo();
    else this.undo();
  }

  /**
   * Several documents can be open at once. The one holding focus answers the shortcut;
   * with focus elsewhere, the most recently edited one does.
   */
  private ownsShortcut(target: EventTarget | null): boolean {
    const el = target instanceof Element ? target : null;
    if (el && isTextEntry(el)) return false;
    const review = el?.closest('app-review');
    if (review) return review === this.host.nativeElement;
    return this.queue.lastEdited() === this.localId();
  }

  protected toggle(pageIndex: number, wordId: number) {
    if (!this.busy()) this.queue.toggleWord(this.localId(), pageIndex, wordId);
  }

  /** Show every occurrence of a hidden word. */
  protected showGroup(g: HiddenGroup) {
    for (const ref of g.refs) {
      const w = this.wordAt(ref.page, ref.id);
      if (w?.hidden) this.queue.toggleWord(this.localId(), ref.page, ref.id);
    }
  }

  /** Turn a sideways page upright. Masks follow; nothing is detected again. */
  protected async rotate(pageIndex: number, turn: Turn) {
    if (this.busy() || this.turning()) return;
    this.turning.set(true);
    try {
      await this.queue.rotatePage(this.localId(), pageIndex, turn);
      this.toast.show(
        'Page turned',
        'Personal details are not looked for again. Check this page and hide anything left by hand.',
      );
    } catch {
      this.toast.show('This page could not be turned. Try again.');
    } finally {
      this.turning.set(false);
    }
  }

  protected addRegion(pageIndex: number, box: Box) {
    if (!this.busy()) this.queue.addRegion(this.localId(), pageIndex, box);
  }

  protected removeRegion(pageIndex: number, index: number) {
    if (!this.busy()) this.queue.removeRegion(this.localId(), pageIndex, index);
  }

  protected rename(value: string) {
    this.queue.rename(this.localId(), value);
  }

  protected rescan() {
    void this.queue.rescan(this.localId(), true);
  }

  protected async approve() {
    const before = this.doc();
    const removed = this.hiddenCount();
    const ok = await this.queue.approve(this.localId());
    if (!ok) return;
    this.toast.show(
      before?.serverId
        ? `Saved changes to “${before.fileName}”`
        : `Saved “${before?.fileName ?? 'document'}”`,
      `${removed} ${removed === 1 ? 'detail' : 'details'} removed. The approved copy is saved in this browser.`,
    );
    if (this.embedded()) return;
    const next = this.queue.documents().find((d) => d.status === 'review');
    if (this.queue.resultsBlocked()) {
      this.queue.openReview(next?.localId);
      void this.router.navigate(['/documents']);
    } else void this.router.navigate(['/results']);
  }

  protected discard() {
    this.queue.remove(this.localId());
    if (!this.embedded()) void this.router.navigate(['/documents']);
  }

  private wordAt(page: number, id: number): WorkingWord | undefined {
    return this.doc()?.pages[page]?.words.find((w) => w.id === id);
  }
}

const NON_TEXT_INPUTS = new Set([
  'checkbox',
  'radio',
  'button',
  'submit',
  'reset',
  'range',
  'color',
  'file',
]);

function isTextEntry(el: Element): boolean {
  if (el instanceof HTMLInputElement) return !NON_TEXT_INPUTS.has(el.type);
  return !!el.closest('textarea, select, [contenteditable]:not([contenteditable="false"])');
}

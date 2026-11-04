import { Component, computed, ElementRef, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DocumentQueueService } from '../core/document-queue.service';
import { ToastService } from '../core/toast.service';
import { Box } from '../core/models';
import { redactionPlan } from '../redaction/burn';
import type { Turn } from '../redaction/rotate';

import { PageView } from './page-view';
import { Icon } from '../ui/icon';
import { StepRail } from '../shell/step-rail';
import { StorageNotice } from '../shell/storage-notice';

@Component({
  selector: 'app-review',
  imports: [PageView, RouterLink, Icon, StepRail, StorageNotice],
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

  protected readonly turning = signal(false);

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
  protected readonly lockedCount = computed(
    () =>
      this.doc()?.pages.reduce(
        (n, p) => n + p.words.filter((w) => w.locked).length + (p.lockedRegions ?? 0),
        0,
      ) ?? 0,
  );

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

  /** Turn a sideways page upright. The boxes turn with it. */
  protected async rotate(pageIndex: number, turn: Turn) {
    if (this.busy() || this.turning()) return;
    this.turning.set(true);
    try {
      await this.queue.rotatePage(this.localId(), pageIndex, turn);
      this.toast.show(
        'Page turned',
        'Your boxes moved with it. Check this page and cover anything still showing.',
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

  protected async approve() {
    const before = this.doc();
    const removed = this.hiddenCount();
    const ok = await this.queue.approve(this.localId());
    if (!ok) return;
    this.toast.show(
      before?.serverId
        ? `Saved changes to “${before.fileName}”`
        : `Saved “${before?.fileName ?? 'document'}”`,
      `${removed} ${removed === 1 ? 'area' : 'areas'} covered. The approved copy is saved in this browser.`,
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

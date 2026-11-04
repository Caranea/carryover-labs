import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DocumentQueueService } from '../core/document-queue.service';
import { LocalDocument } from '../core/models';
import { ReviewPage } from '../review/review.page';
import { Icon } from '../ui/icon';
import { StepRail } from './step-rail';

@Component({
  selector: 'app-detector-status',
  imports: [Icon, ReviewPage, StepRail],
  templateUrl: './detector-status.html',
  styleUrl: './detector-status.css',
})
export class DetectorStatus {
  protected readonly queue = inject(DocumentQueueService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  protected readonly active = computed(() =>
    this.queue.batch().find((doc) => ['reading', 'detecting'].includes(doc.status)),
  );
  protected readonly errors = computed(() =>
    this.queue.batch().filter((doc) => doc.status === 'error'),
  );
  protected readonly selected = computed(() => {
    const doc = this.queue.byId(this.queue.reviewId() ?? '');
    return doc && ['review', 'saving', 'detecting'].includes(doc.status) && doc.pages.length
      ? [doc]
      : [];
  });
  /** Short status shown on the header button; also its tooltip and part of its accessible name. */
  protected readonly statusLabel = computed(() => {
    const batch = this.queue.batchProgress();
    if (batch.ready) return batch.ready + ' ready to check';
    return this.queue.resultsBlocked() ? 'Document progress' : 'Documents approved';
  });
  protected readonly title = computed(() => {
    const batch = this.queue.batchProgress();
    if (batch.ready || this.selected().length) return 'Check and approve your documents';
    if (batch.remaining) return 'Preparing your documents';
    if (batch.errors) return 'Some documents need attention';
    return 'Your documents are approved';
  });
  protected readonly stageTitle = computed(() => {
    const doc = this.active();
    if (!doc) return '';
    return doc.message || 'Opening document';
  });

  constructor() {
    effect(() => {
      const docs = this.queue.batch();
      const selected = docs.find((doc) => doc.localId === this.queue.reviewId());
      // A later file becoming ready must never replace the page being edited.
      if (!selected || !['review', 'saving', 'detecting'].includes(selected.status)) {
        const next = docs.find((doc) => doc.status === 'review');
        if (this.queue.reviewId() !== (next?.localId ?? null))
          this.queue.reviewId.set(next?.localId ?? null);
      }
      if (!docs.length && this.queue.recoveryReady()) this.queue.closeReview();
    });
    effect(() => {
      const show = this.queue.reviewOpened();
      const dialog = this.dialog()?.nativeElement;
      if (!dialog) return;
      untracked(() => {
        if (show && !dialog.open) dialog.showModal();
        else if (!show && dialog.open) dialog.close();
      });
    });
    effect(() => {
      this.queue.reviewId();
      // Approving removes the focused button. Keep keyboard focus in the dialog
      // and announce the next document (or the wait for the rest of the batch).
      afterNextRender(
        () => {
          if (!this.queue.reviewOpened()) return;
          const dialog = this.dialog()?.nativeElement;
          const target =
            dialog?.querySelector<HTMLElement>('app-review [role="region"]') ??
            dialog?.querySelector<HTMLElement>('#privacy-title');
          target?.focus({ preventScroll: true });
        },
        { injector: this.injector },
      );
    });
  }

  protected status(doc: LocalDocument) {
    switch (doc.status) {
      case 'review':
        return 'Ready to check';
      case 'saved':
        return 'Approved';
      case 'saving':
        return 'Saving';
      case 'reading':
        return 'Reading';
      case 'error':
        return 'Needs attention';
      default:
        return 'Waiting';
    }
  }
  protected dismiss(event?: Event) {
    event?.preventDefault();
    this.queue.closeReview();
  }
  protected results() {
    if (this.queue.resultsBlocked()) return;
    this.queue.closeReview();
    void this.router.navigate(['/results']);
  }
}

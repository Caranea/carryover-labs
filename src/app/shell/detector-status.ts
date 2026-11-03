import {
  afterNextRender,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { Router } from '@angular/router';
import { DocumentQueueService } from '../core/document-queue.service';
import { LocalDocument } from '../core/models';
import { NerService } from '../pii/ner.service';
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
  protected readonly ner = inject(NerService);
  protected readonly queue = inject(DocumentQueueService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly dialog = viewChild<ElementRef<HTMLDialogElement>>('dialog');
  private readonly now = signal(Date.now());
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
    if (doc.status === 'reading') return doc.message || 'Reading document';
    switch (this.ner.phase()) {
      case 'preparing':
        return 'Choosing the privacy checker';
      case 'downloading':
        return 'Downloading the privacy checker · ' + Math.round(this.ner.progress() * 100) + '%';
      case 'starting':
        return 'Starting the privacy checker';
      case 'checking':
        return 'Checking page ' + this.ner.pageNumber() + ' of ' + this.ner.pageCount();
      default:
        return doc.message || 'Preparing document';
    }
  });
  /**
   * What a screen reader hears about the current step: it changes with the step, and during the
   * download every tenth, so it is never read out several times a second.
   */
  protected readonly announcement = computed(() => {
    const doc = this.active();
    if (!doc) return '';
    if (doc.status === 'detecting' && this.ner.phase() === 'downloading')
      return `Downloading the privacy checker, ${Math.floor(this.ner.progress() * 10) * 10}% done.`;
    return this.stageTitle();
  });
  protected readonly estimate = computed(() => {
    if (this.active()?.status !== 'detecting') return '';
    const phase = this.ner.phase();
    if (!['preparing', 'downloading', 'starting', 'checking'].includes(phase)) return '';
    if (phase === 'starting') return 'Starting the checker on your device…';
    if (phase === 'preparing') return 'Checking this device before downloading…';
    if (this.now() - this.ner.lastProgressAt() > 15_000)
      return 'Still working — updating the estimate…';
    const seconds = this.ner.remainingSeconds();
    if (seconds === null)
      return phase === 'downloading'
        ? 'Measuring your download speed…'
        : 'Estimating from this page…';
    const duration =
      seconds < 60
        ? Math.max(5, Math.ceil(seconds / 5) * 5) + ' sec'
        : Math.ceil(seconds / 60) + ' min';
    return (
      'About ' +
      duration +
      (phase === 'downloading' ? ' left to download' : ' left for this document')
    );
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
    effect((onCleanup) => {
      if (!this.queue.reviewOpened() || !this.queue.batchProgress().remaining) return;
      this.now.set(Date.now());
      const timer = setInterval(() => this.now.set(Date.now()), 1000);
      onCleanup(() => clearInterval(timer));
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
      case 'detecting':
        return 'Checking';
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
  protected switchMode() {
    this.queue.useLightweightReview();
  }
  protected results() {
    if (this.queue.resultsBlocked()) return;
    this.queue.closeReview();
    void this.router.navigate(['/results']);
  }
}

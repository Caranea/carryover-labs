import { DatePipe } from '@angular/common';
import { Component, computed, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { DocumentQueueService } from '../core/document-queue.service';
import { LocalDocument, PrivacyMode, SavedDocumentSummary, SourceKind } from '../core/models';
import { ACCEPT } from '../extraction/extraction.service';
import { countHidden } from '../pii/detect';
import { StepRail } from '../shell/step-rail';
import { StorageNotice } from '../shell/storage-notice';
import { Icon, IconName } from '../ui/icon';

const KIND_TAG: Record<SourceKind, string> = { pdf: 'PDF', image: 'Photo', docx: 'Word', text: 'Text' };
const KIND_ICON: Record<SourceKind, IconName> = { pdf: 'file-text', image: 'file-image', docx: 'file-type', text: 'file-text' };

@Component({
  selector: 'app-upload',
  imports: [RouterLink, DatePipe, Icon, StepRail, StorageNotice],
  templateUrl: './upload.page.html',
})
export class UploadPage implements OnInit {
  protected readonly queue = inject(DocumentQueueService);
  private readonly router = inject(Router);

  protected readonly accept = ACCEPT;
  protected readonly formats = ['PDF', 'JPG', 'PNG', 'HEIC', 'DOCX', 'TXT', 'CSV'];
  protected readonly kindTag = KIND_TAG;
  protected readonly kindIcon = KIND_ICON;
  protected readonly toDelete = signal<SavedDocumentSummary | null>(null);
  private readonly deleteDialog = viewChild<ElementRef<HTMLDialogElement>>('deleteDialog');
  protected readonly dragging = signal(false);
  protected readonly deleteError = signal<string | null>(null);
  protected readonly privacyMode = signal<PrivacyMode>('automatic');
  private dragDepth = 0;

  protected readonly local = computed(() => this.queue.documents().filter((d) => d.status !== 'saved'));
  protected readonly readyCount = computed(() => this.local().filter((d) => d.status === 'review').length);

  ngOnInit() {
    void this.queue.refreshSaved();
  }

  protected onFiles(input: HTMLInputElement) {
    if (input.files?.length) this.queue.add(Array.from(input.files), this.privacyMode());
    input.value = '';
  }

  protected onDragEnter(event: DragEvent) {
    event.preventDefault();
    this.dragDepth++;
    this.dragging.set(true);
  }

  protected onDragLeave() {
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dragging.set(false);
  }

  protected onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragDepth = 0;
    this.dragging.set(false);
    const files = event.dataTransfer?.files;
    if (files?.length) this.queue.add(Array.from(files), this.privacyMode());
  }

  protected hidden(doc: LocalDocument): number {
    return countHidden(doc.pages);
  }

  protected busy(doc: LocalDocument): boolean {
    return doc.status === 'reading' || doc.status === 'detecting' || doc.status === 'saving';
  }

  protected review(doc: LocalDocument) {
    void this.router.navigate(['/review', doc.localId]);
  }

  protected askDelete(doc: SavedDocumentSummary) {
    this.toDelete.set(doc);
    this.deleteError.set(null);
    this.deleteDialog()?.nativeElement.showModal();
  }

  protected async confirmDelete() {
    const doc = this.toDelete();
    if (!doc) return;
    try {
      await this.queue.deleteSaved(doc.id);
      this.deleteDialog()?.nativeElement.close();
      this.toDelete.set(null);
    } catch {
      this.deleteError.set(`“${doc.name}” could not be deleted. Try again.`);
    }
  }

  protected statusBadge(doc: LocalDocument): { text: string; cls: string } {
    switch (doc.status) {
      case 'queued':
        return { text: 'Waiting', cls: 'badge-ghost' };
      case 'reading':
        return { text: 'Reading', cls: 'badge-info badge-soft' };
      case 'detecting':
        return { text: 'Finding details', cls: 'badge-info badge-soft' };
      case 'saving':
        return { text: 'Saving', cls: 'badge-info badge-soft' };
      case 'review':
        return { text: 'Ready to check', cls: 'badge-success badge-soft' };
      case 'error':
        return { text: 'Could not read', cls: 'badge-error badge-soft' };
      default:
        return { text: '', cls: '' };
    }
  }

  protected statusLine(doc: LocalDocument): string {
    switch (doc.status) {
      case 'queued':
        return 'Waits for the file before it';
      case 'review': {
        const n = this.hidden(doc);
        return `${n} ${n === 1 ? 'detail' : 'details'} blacked out across ${doc.pages.length} ${doc.pages.length === 1 ? 'page' : 'pages'}`;
      }
      case 'error':
        return doc.error ?? 'Something went wrong';
      default:
        return doc.message || 'Working';
    }
  }
}


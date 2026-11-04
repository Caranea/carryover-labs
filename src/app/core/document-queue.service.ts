import { errorMessage } from './errors';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ExtractionService, sourceKindOf } from '../extraction/extraction.service';
import { PRIVACY_VERSION } from '../pii/privacy-version';
import { sanitizeFileName } from '../pii/file-name';
import { buildManifest, burnPage, fromTuple } from '../redaction/burn';
import { addArea, removeArea, revokePageUrls } from '../redaction/page-edits';
import { turnImage, turnPageGeometry, type Turn } from '../redaction/rotate';
import { LocalHistory } from './local-history';
import { ResultsService } from './results.service';
import { Box, LocalDocument, SavedDocumentSummary, WorkingPage } from './models';
import { QueueRecovery, QueueSnapshot } from './queue-recovery';
import { EditHistory } from './edit-history';
import { restoredDocument } from './restore-document';
import { DEMO_DOCUMENTS } from './demo-documents';

/**
 * Holds every document being prepared on this device and the list of
 * documents saved in this browser. Files are processed one at a time so a
 * phone does not run out of memory.
 */
@Injectable({ providedIn: 'root' })
export class DocumentQueueService {
  private readonly extraction = inject(ExtractionService);
  private readonly results = inject(ResultsService);
  private readonly history = inject(LocalHistory);
  readonly processing = this.results.processing;
  readonly recovery = inject(QueueRecovery);
  readonly recoveryReady = signal(!this.recovery.available);
  readonly restoring = signal(this.recovery.available);
  readonly ready: Promise<void>;

  readonly documents = signal<LocalDocument[]>([]);
  readonly saved = signal<SavedDocumentSummary[] | null>(null);
  readonly savedError = signal<string | null>(null);
  /** The person covers personal details by hand; no rule or model looks at a page. */

  readonly pending = computed(() => this.documents().filter((d) => d.status !== 'saved'));
  readonly resultsBlocked = computed(() => !this.recoveryReady() || this.pending().length > 0);
  readonly reviewOpened = signal(false);
  readonly reviewId = signal<string | null>(null);
  private readonly batchIds = signal<string[]>([]);
  readonly batch = computed(() => {
    const ids = new Set(this.batchIds());
    return this.documents().filter((doc) => ids.has(doc.localId));
  });
  readonly batchProgress = computed(() => {
    const docs = this.batch();
    const ready = docs.filter((doc) => doc.status === 'review').length;
    const approved = docs.filter((doc) => doc.status === 'saved').length;
    const errors = docs.filter((doc) => doc.status === 'error').length;
    const remaining = docs.filter((doc) =>
      ['queued', 'reading', 'detecting'].includes(doc.status),
    ).length;
    const prepared = docs.filter((doc) =>
      ['review', 'saving', 'saved'].includes(doc.status),
    ).length;
    const progress = docs.reduce(
      (total, doc) =>
        total +
        (['review', 'saving', 'saved'].includes(doc.status)
          ? 1
          : doc.status === 'reading'
            ? Math.min(0.7, doc.progress)
            : 0),
      0,
    );
    return {
      total: docs.length,
      ready,
      approved,
      errors,
      remaining,
      prepared,
      percent: docs.length ? Math.round((progress / docs.length) * 100) : 0,
    };
  });

  openReview(localId?: string) {
    const ids = new Set([...this.batchIds(), ...this.pending().map((doc) => doc.localId)]);
    if (localId) ids.add(localId);
    this.batchIds.set([...ids]);
    if (localId) this.reviewId.set(localId);
    this.reviewOpened.set(true);
  }

  closeReview() {
    this.reviewOpened.set(false);
  }

  private running = false;
  private destroyed = false;
  private counter = 0;
  private readonly activeChecks = new Map<string, AbortController>();
  /** Hand-edit history per document: page snapshots to step back and forward through. */
  private readonly edits = new EditHistory();
  /** The document edited most recently, for keyboard undo when focus is outside any page. */
  readonly lastEdited = this.edits.lastEdited.asReadonly();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      for (const check of this.activeChecks.values()) check.abort();
    });
    this.ready = this.recovery.available
      ? this.restoreQueue()
      : this.recovery.load().then(() => {});
    effect(() => {
      if (!this.recoveryReady()) return;
      const snapshot = this.snapshot();
      untracked(() => {
        void this.recovery.save(snapshot).catch(() => {});
      });
    });
    effect(() => {
      if (!this.recoveryReady()) return;
      const ready = this.pending().length === 0;
      // Approval can start transcription while the remaining originals are still being prepared.
      untracked(() => this.results.prepareBatch(ready));
    });
    const protect = (event: BeforeUnloadEvent) => {
      const snapshot = this.snapshot();
      if (
        this.recoveryReady() &&
        (snapshot.documents.length || this.recovery.available) &&
        !this.recovery.isSaved(snapshot)
      ) {
        void this.recovery.save(snapshot).catch(() => {});
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const checkpoint = () => {
      if (document.visibilityState === 'hidden' && this.recoveryReady())
        void this.recovery.save(this.snapshot()).catch(() => {});
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', protect);
      document.addEventListener('visibilitychange', checkpoint);
      inject(DestroyRef).onDestroy(() => {
        window.removeEventListener('beforeunload', protect);
        document.removeEventListener('visibilitychange', checkpoint);
      });
    }
  }

  private snapshot(): QueueSnapshot {
    return {
      documents: this.documents(),
      batchIds: this.batchIds(),
      reviewId: this.reviewId(),
      reviewOpened: this.reviewOpened(),
      counter: this.counter,
    };
  }

  async retryRecovery() {
    if (!this.recoveryReady()) await this.restoreQueue();
    else {
      try {
        await this.recovery.save(this.snapshot());
        void this.run();
      } catch {
        /* Keep unsaved files in this tab. */
      }
    }
  }

  private async restoreQueue() {
    this.restoring.set(true);
    try {
      const snapshot = await this.recovery.load();
      if (snapshot) {
        const approved = this.history.approvedQueueDocuments();
        const documents = snapshot.documents.map((doc) =>
          restoredDocument(doc, !doc.serverId ? approved.get(doc.localId) : undefined),
        );
        this.documents.set(documents);
        this.batchIds.set(snapshot.batchIds);
        this.counter = snapshot.counter;
        this.reviewId.set(snapshot.reviewId);
        this.reviewOpened.set(snapshot.reviewOpened);
        this.recovery.restored(this.snapshot());
      }
      this.recoveryReady.set(true);
      void this.run();
    } catch (error) {
      this.recovery.failed(error); /* Keep the checkpoint intact; offer retry. */
    } finally {
      this.restoring.set(false);
    }
  }
  byId(localId: string): LocalDocument | undefined {
    return this.documents().find((d) => d.localId === localId);
  }

  // ---------------------------------------------------------------------------
  // Adding and processing files
  // ---------------------------------------------------------------------------

  /**
   * Add sample patient documents (DEMO_DOCUMENTS ids). They go through the same review and
   * approval as your own files; the server answers them from recorded Meta answers.
   */
  addSamples(ids: string[]): string[] {
    if (!this.recoveryReady()) return [];
    const added = DEMO_DOCUMENTS.filter((doc) => ids.includes(doc.id)).map(
      (sample): LocalDocument => ({
        localId: crypto.randomUUID(),
        name: `Lab document ${++this.counter}`,
        generatedName: `Lab document ${this.counter}`,
        fileName: sample.name,
        sourceKind: sample.kind,
        status: 'queued',
        progress: 0,
        message: 'Waiting',
        pages: [],
        file: null,
        sample: sample.id,
        addedAt: Date.now(),
      }),
    );
    return this.enqueue(added);
  }

  add(files: Iterable<File>): string[] {
    if (!this.recoveryReady()) return [];
    const added: LocalDocument[] = [];
    for (const file of files) {
      const kind = sourceKindOf(file);
      added.push({
        localId: crypto.randomUUID(),
        name: `Lab document ${++this.counter}`,
        generatedName: `Lab document ${this.counter}`,
        fileName: file.name,
        sourceKind: kind ?? 'text',
        status: kind ? 'queued' : 'error',
        progress: 0,
        message: kind ? 'Waiting' : '',
        error: kind
          ? undefined
          : 'This file type is not supported. Use PDF, a photo, Word (.docx) or text.',
        pages: [],
        file: kind ? file : null,
        addedAt: Date.now(),
      });
    }
    return this.enqueue(added);
  }

  private enqueue(added: LocalDocument[]): string[] {
    if (!added.length) return [];
    // Start a fresh batch after the previous one has been approved or discarded.
    if (!this.resultsBlocked()) {
      this.batchIds.set([]);
      this.reviewId.set(null);
    }
    this.batchIds.update((ids) => [...ids, ...added.map((doc) => doc.localId)]);
    this.documents.update((docs) => [...docs, ...added]);
    this.results.prepareBatch(false);
    this.reviewOpened.set(true);
    if (added.some((d) => d.status === 'queued')) {
      void this.run();
    }
    return added.map((d) => d.localId);
  }

  retry(localId: string) {
    const doc = this.byId(localId);
    if (!doc?.file && !doc?.sample) return;
    this.patch(localId, { status: 'queued', error: undefined, progress: 0, message: 'Waiting' });
    void this.run();
  }

  private async run() {
    if (this.running || this.destroyed) return;
    this.running = true;
    try {
      // Checkpoint the originals before OCR starts.
      await this.recovery.save(this.snapshot());
      let next: LocalDocument | undefined;
      while (!this.destroyed && (next = this.documents().find((d) => d.status === 'queued'))) {
        await this.process(next);
      }
    } catch {
      /* Recovery exposes the save error; do not start reading. */
    } finally {
      this.running = false;
    }
  }

  private async process(doc: LocalDocument) {
    const id = doc.localId;
    const abort = new AbortController();
    this.activeChecks.set(id, abort);
    try {
      this.patch(id, { status: 'reading', progress: 0, message: 'Opening' });
      const progress = (fraction: number, message: string) =>
        this.patch(id, { progress: fraction * 0.7, message });
      const sample = DEMO_DOCUMENTS.find((d) => d.id === doc.sample);
      const pages = doc.pages.length
        ? doc.pages
        : sample
          ? await this.extraction.extractSample(sample.pages, progress)
          : await this.extraction.extract(doc.file!, progress);
      if (this.destroyed || !this.byId(id)) return revokePageUrls(pages);

      this.patch(id, {
        status: 'review',
        privacyVersion: PRIVACY_VERSION,
        progress: 1,
        message: '',
        pages,
      });
    } catch (e) {
      this.patch(id, {
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
        message: '',
      });
    } finally {
      this.activeChecks.delete(id);
    }
  }

  // ---------------------------------------------------------------------------
  // Hand edits
  // ---------------------------------------------------------------------------

  addRegion(localId: string, pageIndex: number, region: Box) {
    this.editPages(localId, (pages) => addArea(pages, pageIndex, region));
  }

  removeRegion(localId: string, pageIndex: number, regionIndex: number) {
    this.editPages(localId, (pages) => removeArea(pages, pageIndex, regionIndex));
  }

  /**
   * Turn a sideways or upside-down page a quarter. Boxes turn with it. Undo restores the
   * previous orientation.
   */
  async rotatePage(localId: string, pageIndex: number, turn: Turn) {
    const page = this.byId(localId)?.pages[pageIndex];
    if (!page?.image) return;
    const image = await turnImage(page.image, turn);
    this.editPages(localId, (pages) =>
      pages.map((p, i) =>
        // A page changed while the image was turning (another click) keeps its newer state.
        i === pageIndex && p.image === page.image
          ? { ...turnPageGeometry(p, turn), image, imageUrl: URL.createObjectURL(image) }
          : p,
      ),
    );
  }

  canUndo(localId: string): boolean {
    return this.edits.canUndo(localId);
  }

  canRedo(localId: string): boolean {
    return this.edits.canRedo(localId);
  }

  /** Step back through hand edits: drawn areas and page turns. */
  undo(localId: string) {
    this.stepEdit(localId, 'undo');
  }

  redo(localId: string) {
    this.stepEdit(localId, 'redo');
  }

  rename(localId: string, name: string) {
    this.patch(localId, { name: name.slice(0, 120), error: undefined });
  }

  remove(localId: string) {
    this.activeChecks.get(localId)?.abort();
    this.activeChecks.delete(localId);
    const doc = this.byId(localId);
    if (doc) revokePageUrls(doc.pages);
    this.clearEdits(localId);
    this.documents.update((docs) => docs.filter((d) => d.localId !== localId));
  }

  // ---------------------------------------------------------------------------
  // Saving in this browser
  // ---------------------------------------------------------------------------

  async approve(localId: string): Promise<boolean> {
    const doc = this.byId(localId);
    if (!doc || doc.status !== 'review') return false;
    // This explicit action is the privacy approval; no separate acknowledgement is required.
    const name = doc.name.trim() || 'Document';
    const generated = name === doc.generatedName;
    const safeName = sanitizeFileName(`${name}.txt`);
    // A report date in a title is fine; a long number may be an ID.
    const withoutDates = name.replace(/\b\d{4}-\d{2}-\d{2}\b/g, '');
    if (!generated && (safeName !== name || /@|\b\d[\d\s-]{6,}\b/.test(withoutDates))) {
      this.patch(localId, {
        error:
          'The document name may contain personal details. Use a general name such as Thyroid tests.',
      });
      return false;
    }
    this.patch(localId, {
      status: 'saving',
      message: 'Blacking out hidden details',
      error: undefined,
    });
    try {
      const images: (Blob | null)[] = [];
      const started = performance.now();
      for (const page of doc.pages) {
        images.push(await burnPage(page));
        if (!this.byId(localId)) return false;
      }
      const manifest = buildManifest(doc, name);
      console.info('[Carryover timing]', {
        stage: 'redacted-image-preparation',
        documentId: localId,
        pages: images.length,
        elapsedMs: Math.round(performance.now() - started),
      });
      this.patch(localId, { message: 'Saving on this device' });
      const summary = doc.serverId
        ? await this.history.replace(doc.serverId, manifest, images)
        : await this.history.create(manifest, images, doc.fileName, doc.localId, doc.sample);
      if (!this.byId(localId)) return false;
      // The originals are no longer needed on this device either.
      revokePageUrls(this.byId(localId)?.pages ?? []);
      this.patch(localId, {
        status: 'saved',
        serverId: summary.id,
        message: '',
        file: null,
        pages: [],
      });
      this.upsertSaved(summary);
      this.clearEdits(localId);
      return true;
    } catch (e) {
      this.patch(localId, { status: 'review', message: '', error: errorMessage(e) });
      return false;
    }
  }

  /** Open a saved document to hide more. Hidden parts stay hidden in its local copy. */
  async openSaved(serverId: string): Promise<string> {
    const existing = this.documents().find((d) => d.serverId === serverId && d.status === 'review');
    if (existing) return existing.localId;

    const doc = await this.history.get(serverId);
    const pages: WorkingPage[] = [];
    let nextId = 0;
    try {
      for (const p of doc.pages) {
        const image = p.hasImage ? await this.history.pageImage(serverId, p.index) : null;
        pages.push({
          index: p.index,
          width: p.width,
          height: p.height,
          image,
          imageUrl: image ? URL.createObjectURL(image) : null,
          ocr: p.ocr,
          regions: p.regions.map(fromTuple),
          lockedRegions: p.regions.length,
          words: p.words.map((w) => ({
            id: nextId++,
            text: w.t,
            box: w.b ? fromTuple(w.b) : undefined,
            line: w.l,
            hidden: !!w.h,
            locked: !!w.h,
            kind: w.k,
          })),
        });
      }
    } catch (error) {
      revokePageUrls(pages);
      throw error;
    }

    const localId = `saved-${serverId}-${this.counter++}`;
    this.documents.update((docs) => [
      ...docs,
      {
        localId,
        serverId,
        name: doc.name,
        fileName: doc.originalFileName || doc.name,
        sourceKind: doc.sourceKind,
        status: 'review',
        progress: 1,
        message: '',
        pages,
        file: null,
        addedAt: Date.now(),
      },
    ]);
    return localId;
  }

  async refreshSaved() {
    try {
      this.savedError.set(null);
      const list = await this.history.list();
      this.saved.set(list);
    } catch (e) {
      this.savedError.set(errorMessage(e));
    }
  }

  async retryProcessing() {
    try {
      await this.results.retryRecords();
      await this.refreshSaved();
    } catch {
      /* The existing progress panel shows retry errors. */
    }
  }

  async deleteSaved(serverId: string) {
    await this.history.delete(serverId);
    this.saved.update((list) => list?.filter((d) => d.id !== serverId) ?? null);
    for (const d of this.documents().filter((x) => x.serverId === serverId)) this.remove(d.localId);
  }

  private upsertSaved(summary: SavedDocumentSummary) {
    this.saved.update((list) => [summary, ...(list ?? []).filter((d) => d.id !== summary.id)]);
  }

  // ---------------------------------------------------------------------------

  private patch(localId: string, patch: Partial<LocalDocument>) {
    this.documents.update((docs) =>
      docs.map((d) => (d.localId === localId ? { ...d, ...patch } : d)),
    );
  }

  private updatePages(localId: string, fn: (pages: WorkingPage[]) => WorkingPage[]) {
    this.documents.update((docs) =>
      docs.map((d) =>
        d.localId === localId && d.status === 'review' ? { ...d, pages: fn(d.pages) } : d,
      ),
    );
  }

  /** A hand edit: records the pages before it so it can be undone. */
  private editPages(localId: string, fn: (pages: WorkingPage[]) => WorkingPage[]) {
    let before: WorkingPage[] | null = null;
    this.updatePages(localId, (pages) => {
      const next = fn(pages);
      if (next.length !== pages.length || next.some((p, i) => p !== pages[i])) before = pages;
      return next;
    });
    if (before) this.edits.record(localId, before);
  }

  private stepEdit(localId: string, direction: 'undo' | 'redo') {
    const doc = this.byId(localId);
    if (doc?.status !== 'review') return;
    const pages = this.edits.step(localId, direction, doc.pages);
    if (pages) this.updatePages(localId, () => pages);
  }

  private clearEdits(localId: string) {
    this.edits.clear(localId);
  }
}

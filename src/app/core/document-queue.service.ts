import { errorMessage } from './errors';
import { computed, DestroyRef, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { ExtractionService, sourceKindOf } from '../extraction/extraction.service';
import {
  applyDetections,
  clearAutomaticDetections,
  NORMAL,
  PagePredictions,
  PRIVACY_VERSION,
  STRICT,
} from '../pii/detect';
import { NerService } from '../pii/ner.service';
import { fileNameHints, sanitizeFileName } from '../pii/rules';
import {
  applyRegion,
  buildManifest,
  burnPage,
  fromTuple,
  redactionPlan,
  removeRegion,
} from '../redaction/burn';
import { intersects } from '../redaction/geometry';
import { LocalHistory } from './local-history';
import { ResultsService } from './results.service';
import {
  Box,
  LocalDocument,
  PrivacyMode,
  SavedDocumentSummary,
  WorkingPage,
  WorkingWord,
} from './models';
import { QueueRecovery, QueueSnapshot } from './queue-recovery';
import { applyRememberedDetails, learnDetails, RememberedDetails } from '../pii/remembered-details';
import { documentReportDate } from './document-name';
import { protectMedicalTerms } from '../pii/medical-terms';

/**
 * Holds every document being prepared on this device and the list of
 * documents saved in this browser. Files are processed one at a time so a
 * phone does not run out of memory.
 */
@Injectable({ providedIn: 'root' })
export class DocumentQueueService {
  private readonly extraction = inject(ExtractionService);
  private readonly ner = inject(NerService);
  private readonly results = inject(ResultsService);
  private readonly history = inject(LocalHistory);
  readonly processing = this.results.processing;
  readonly batchId = signal<string>(crypto.randomUUID());
  readonly recovery = inject(QueueRecovery);
  readonly recoveryReady = signal(!this.recovery.available);
  readonly restoring = signal(this.recovery.available);
  readonly ready: Promise<void>;

  readonly documents = signal<LocalDocument[]>([]);
  readonly saved = signal<SavedDocumentSummary[] | null>(null);
  readonly savedError = signal<string | null>(null);
  readonly privacyMode = signal<PrivacyMode>('automatic');
  readonly privacyModeChosen = signal(false);

  choosePrivacyMode(mode: PrivacyMode) {
    this.privacyModeChosen.set(true);
    this.privacyMode.set(mode);
  }

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
            : doc.status === 'detecting'
              ? 0.7 + 0.3 * this.ner.checkProgress()
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

  private predictions = new Map<string, PagePredictions[]>();
  private running = false;
  private destroyed = false;
  private counter = 0;
  private readonly activeChecks = new Map<string, AbortController>();
  private readonly rememberedDetails = signal<RememberedDetails>({});

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
      const batchId = this.batchId();
      // Approval can start transcription while the remaining originals are still being prepared.
      untracked(() => this.results.prepareBatch(batchId, ready));
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
      batchId: this.batchId(),
      documents: this.documents(),
      batchIds: this.batchIds(),
      reviewId: this.reviewId(),
      reviewOpened: this.reviewOpened(),
      privacyMode: this.privacyMode(),
      privacyModeChosen: this.privacyModeChosen(),
      counter: this.counter,
      rememberedDetails: this.rememberedDetails(),
      rememberedDetailsVersion: PRIVACY_VERSION,
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
        this.batchId.set(snapshot.batchId ?? crypto.randomUUID());
        const approved = this.history.approvedQueueDocuments();
        const documents = snapshot.documents.map((doc): LocalDocument => {
          const saved = !doc.serverId ? approved.get(doc.localId) : undefined;
          if (saved)
            return {
              ...doc,
              status: 'saved',
              serverId: saved.id,
              pages: [],
              file: null,
              error: undefined,
            };
          const pages = doc.pages.map((page) => ({
            ...page,
            imageUrl: page.image ? URL.createObjectURL(page.image) : null,
          }));
          const file = doc.file
            ? new File([doc.file], doc.fileName, { type: doc.file.type })
            : null;
          if (
            !doc.serverId &&
            doc.status !== 'saved' &&
            doc.privacyVersion !== PRIVACY_VERSION &&
            pages.length
          ) {
            if (doc.privacyMode === 'lightweight') {
              const clean = clearAutomaticDetections(pages);
              return {
                ...doc,
                file,
                pages: clean,
                privacyVersion: PRIVACY_VERSION,
                status: 'review',
                message: '',
              };
            }
            // Recheck saved OCR, never reread the photo. Existing masks and hand
            // edits stay in the checkpoint while this queued check is running.
            return {
              ...doc,
              file,
              pages,
              status: 'queued',
              progress: 0.7,
              message: 'Updating privacy check',
            };
          }
          if (['queued', 'reading', 'detecting'].includes(doc.status))
            return {
              ...doc,
              file,
              pages,
              status: 'queued',
              progress: 0,
              message: 'Waiting to resume',
            };
          return {
            ...doc,
            file,
            pages,
            status: doc.status === 'saving' ? 'review' : doc.status,
            message: '',
          };
        });
        this.documents.set(documents);
        this.batchIds.set(snapshot.batchIds);
        this.counter = snapshot.counter;
        // Legacy memory contains guesses with no evidence/provenance. Rebuild it
        // from rechecked originals; never reuse those guesses as confirmed PII.
        const memory =
          snapshot.rememberedDetailsVersion === PRIVACY_VERSION
            ? { ...snapshot.rememberedDetails }
            : {};
        for (const doc of documents)
          if (doc.status === 'review') memory[doc.localId] = learnDetails(doc.pages);
        this.rememberedDetails.set(memory);
        this.refreshReviewDetails();
        this.reviewId.set(snapshot.reviewId);
        this.reviewOpened.set(snapshot.reviewOpened);
        this.privacyMode.set(snapshot.privacyMode);
        this.privacyModeChosen.set(snapshot.privacyModeChosen);
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

  add(files: Iterable<File>, privacyMode: PrivacyMode = this.privacyMode()): string[] {
    if (!this.recoveryReady()) return [];
    this.privacyModeChosen.set(true);
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
        strict: false,
        privacyMode,
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
    if (!added.length) return [];
    // Start a fresh batch after the previous one has been approved or discarded.
    if (!this.resultsBlocked()) {
      this.batchIds.set([]);
      this.batchId.set(crypto.randomUUID());
      this.reviewId.set(null);
    }
    this.batchIds.update((ids) => [...ids, ...added.map((doc) => doc.localId)]);
    this.documents.update((docs) => [...docs, ...added]);
    this.results.prepareBatch(this.batchId(), false);
    this.reviewOpened.set(true);
    if (added.some((d) => d.status === 'queued')) {
      void this.run();
    }
    return added.map((d) => d.localId);
  }

  retry(localId: string) {
    const doc = this.byId(localId);
    if (!doc?.file) return;
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
      /* Recovery exposes the save error; do not start OCR. */
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
      const pages = doc.pages.length
        ? doc.pages
        : await this.extraction.extract(doc.file!, (fraction, message) =>
            this.patch(id, { progress: fraction * 0.7, message }),
          );
      if (this.destroyed || !this.byId(id)) return revokePages(pages);

      const mode = this.byId(id)!.privacyMode;
      this.patch(id, {
        status: 'detecting',
        progress: 0.7,
        message:
          mode === 'lightweight'
            ? 'Preparing for you to hide personal details'
            : 'Finding personal details',
        pages,
      });
      const piiStarted = performance.now();
      const predictions =
        mode === 'lightweight'
          ? pages.map(() => null)
          : await this.ner.predict(pages, abort.signal);
      const current = this.byId(id);
      if (this.destroyed || !current) return;
      this.predictions.set(id, predictions);
      // Re-read the mode after awaiting: switching to manual must also bypass rules
      // and filename hints when an in-flight model result arrives or is cancelled.
      const detected =
        current.privacyMode === 'lightweight'
          ? current.pages
          : applyDetections(
              current.pages,
              predictions,
              current.strict ? STRICT : NORMAL,
              fileNameHints(current.fileName),
            );
      this.patch(id, {
        status: 'review',
        privacyVersion: PRIVACY_VERSION,
        progress: 1,
        message: '',
        pages: detected,
        strict: current.strict,
        ...privacyStatus(pages, predictions, current.privacyMode, this.ner.error()),
      });
      this.refreshReviewDetails(id);
      console.info('[Carryover timing]', {
        stage: 'pii-detection',
        batchId: this.batchId(),
        documentId: id,
        pages: pages.length,
        elapsedMs: Math.round(performance.now() - piiStarted),
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

  /** A thorough pass highlights more uncertain candidates. Hand edits are kept. */
  async rescan(localId: string, strict = true) {
    const doc = this.byId(localId);
    if (!doc || doc.status !== 'review' || doc.privacyMode === 'lightweight') return;
    const abort = new AbortController();
    this.activeChecks.set(localId, abort);
    this.patch(localId, { status: 'detecting', strict, message: 'Checking again, more strictly' });
    try {
      let predictions = this.predictions.get(localId);
      if (!predictions || predictions.some((p) => p === null)) {
        this.ner.retry();
        predictions = await this.ner.predict(doc.pages, abort.signal);
        if (this.byId(localId)) this.predictions.set(localId, predictions);
      }
      const current = this.byId(localId);
      if (!current) return;
      const manual = current.privacyMode === 'lightweight';
      const pages = manual
        ? current.pages
        : applyDetections(
            current.pages,
            predictions,
            strict ? STRICT : NORMAL,
            fileNameHints(current.fileName),
          );
      this.patch(localId, {
        status: 'review',
        privacyVersion: PRIVACY_VERSION,
        message: '',
        pages,
        strict: !manual && strict,
        ...privacyStatus(pages, predictions, current.privacyMode, this.ner.error()),
      });
      this.refreshReviewDetails(localId);
    } catch (e) {
      this.patch(localId, {
        status: 'review',
        message: '',
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      this.activeChecks.delete(localId);
    }
  }

  /** Download/use the larger local model only after the user explicitly chooses it. */
  async runAutomaticCheck(localId: string) {
    const doc = this.byId(localId);
    if (!doc || doc.status !== 'review') return;
    this.patch(localId, { privacyMode: 'automatic', strict: false });
    this.predictions.delete(localId);
    await this.rescan(localId, true);
  }

  /** Keep the files and reviewed masks, stop expensive work, and apply the choice to waiting files. */
  useLightweightReview() {
    this.choosePrivacyMode('lightweight');
    const affected = this.documents().filter(
      (doc) =>
        doc.privacyMode !== 'lightweight' &&
        (['queued', 'reading', 'detecting'].includes(doc.status) ||
          (doc.status === 'review' && doc.privacyCheck === 'incomplete')),
    );
    for (const doc of affected) {
      this.patch(doc.localId, {
        privacyMode: 'lightweight',
        ...(doc.status === 'review' ? privacyStatus(doc.pages, [], 'lightweight') : {}),
      });
    }
    for (const doc of affected) this.activeChecks.get(doc.localId)?.abort();
    this.ner.cancel();
  }

  // ---------------------------------------------------------------------------
  // Hand edits
  // ---------------------------------------------------------------------------

  /** Hide or show one word. Hiding also hides the same word everywhere else in the document. */
  toggleWord(localId: string, pageIndex: number, wordId: number) {
    this.updatePages(localId, (pages) => {
      const word = pages[pageIndex]?.words.find((w) => w.id === wordId);
      if (!word || word.locked || word.text === null) return pages;
      // A region remains opaque until removed. Keeping its text must not change the upload.
      if (word.box && pages[pageIndex].regions.some((r) => intersects(word.box!, r))) return pages;
      const hide = !word.hidden;
      return pages.map((page, p) => ({
        ...page,
        words: page.words.map((w): WorkingWord => {
          if (p === pageIndex && w.id === wordId) {
            return hide
              ? {
                  ...w,
                  hidden: true,
                  userSet: true,
                  source: 'you',
                  kind: w.kind ?? w.candidate ?? 'other',
                  candidate: undefined,
                }
              : {
                  ...w,
                  hidden: false,
                  userSet: true,
                  source: undefined,
                  kind: undefined,
                  candidate: undefined,
                };
          }
          return w;
        }),
      }));
    });
  }

  addRegion(localId: string, pageIndex: number, region: Box) {
    if (region.w < 4 || region.h < 4) return;
    this.updatePages(localId, (pages) =>
      pages.map((p, i) => (i === pageIndex ? applyRegion(p, region) : p)),
    );
  }

  removeRegion(localId: string, pageIndex: number, regionIndex: number) {
    this.updatePages(localId, (pages) =>
      pages.map((p, i) =>
        i === pageIndex && regionIndex >= (p.lockedRegions ?? 0) ? removeRegion(p, regionIndex) : p,
      ),
    );
  }

  rename(localId: string, name: string) {
    this.patch(localId, { name: name.slice(0, 120), error: undefined });
  }

  remove(localId: string) {
    this.activeChecks.get(localId)?.abort();
    this.activeChecks.delete(localId);
    const doc = this.byId(localId);
    if (doc) revokePages(doc.pages);
    this.predictions.delete(localId);
    this.documents.update((docs) => docs.filter((d) => d.localId !== localId));
    this.rememberedDetails.update((memory) => {
      const { [localId]: _removed, ...rest } = memory;
      return rest;
    });
    this.refreshReviewDetails();
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
    const hiddenText = doc.pages.flatMap((page) =>
      [...redactionPlan(page).hidden]
        .map((index) => page.words[index].text)
        .filter((text): text is string => text !== null),
    );
    const safeName = sanitizeFileName(`${name}.txt`, hiddenText);
    // Generated titles use fixed test labels and a visible report date. A user can
    // edit the description while keeping that date without it becoming an ID warning.
    const reportDate = documentReportDate(doc.pages);
    const withoutReportDate = reportDate ? name.replaceAll(reportDate, '') : name;
    if (!generated && (safeName !== name || /@|\b\d[\d\s-]{6,}\b/.test(withoutReportDate))) {
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
        batchId: this.batchId(),
        documentId: localId,
        pages: images.length,
        elapsedMs: Math.round(performance.now() - started),
      });
      this.patch(localId, { message: 'Saving on this device' });
      const summary = doc.serverId
        ? await this.history.replace(doc.serverId, manifest, images)
        : await this.history.create(manifest, images, doc.fileName, doc.localId, this.batchId());
      if (!this.byId(localId)) return false;
      // The originals are no longer needed on this device either.
      revokePages(this.byId(localId)?.pages ?? []);
      this.patch(localId, {
        status: 'saved',
        serverId: summary.id,
        message: '',
        file: null,
        pages: [],
      });
      this.upsertSaved(summary);
      this.predictions.delete(localId);
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
      revokePages(pages);
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
        strict: false,
        progress: 1,
        privacyCheck: 'manual',
        privacyMessage: 'Check every page and confirm the permanent blackouts before saving.',
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
    this.refreshReviewDetails(localId);
  }

  private refreshReviewDetails(sourceId?: string) {
    const source = sourceId ? this.byId(sourceId) : undefined;
    if (source?.status === 'review') {
      const learned = learnDetails(source.pages);
      this.rememberedDetails.update((memory) =>
        JSON.stringify(memory[source.localId]) === JSON.stringify(learned)
          ? memory
          : { ...memory, [source.localId]: learned },
      );
    }
    const memory = this.rememberedDetails();
    this.documents.update((docs) =>
      docs.map((doc) => {
        if (!['review', 'detecting'].includes(doc.status) || !doc.pages.length) return doc;
        if (
          doc.privacyMode !== 'lightweight' &&
          !doc.serverId &&
          doc.privacyVersion !== PRIVACY_VERSION
        )
          return doc;
        // Same-document and cross-document matches follow the same reversible rule.
        const pages = applyRememberedDetails(protectMedicalTerms(doc.pages), memory);
        return pages === doc.pages ? doc : { ...doc, pages };
      }),
    );
  }
}

function revokePages(pages: WorkingPage[]) {
  for (const p of pages) if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
}

function privacyStatus(
  pages: WorkingPage[],
  predictions: PagePredictions[],
  mode: PrivacyMode = 'automatic',
  reason?: string | null,
): Pick<LocalDocument, 'privacyCheck' | 'privacyMessage'> {
  if (mode === 'lightweight')
    return {
      privacyCheck: 'manual',
      privacyMessage:
        'Manual review: matches to personal details hidden in earlier documents are already hidden. Click or tap any other personal details to hide them, including names, addresses, email addresses, phone numbers and identification numbers. Draw boxes over stamps and signatures. Check every page before saving.',
    };
  if (pages.some((page) => page.image))
    return {
      privacyCheck: 'incomplete',
      privacyMessage:
        'The local privacy check uses one OCR pass without rotating pages. Sideways, upside-down or difficult pages can have missed names and incorrect text boxes. Inspect every page and draw boxes over remaining personal details before approving upload.',
    };
  const incomplete = pages.some((page, i) => {
    const hasText = page.words.some((w) => w.text !== null);
    return (hasText && !predictions[i]) || (!!page.image && !hasText);
  });
  return incomplete
    ? {
        privacyCheck: 'incomplete',
        privacyMessage:
          (reason ? reason + ' ' : 'The full privacy check could not check every page. ') +
          'A basic check still looked for details such as email addresses and phone numbers. Names and addresses may have been missed. Inspect every page and hide any remaining personal details before saving.',
      }
    : {
        privacyCheck: 'complete',
        privacyMessage:
          'Automatic checks finished. They can still miss details, so check each page before saving.',
      };
}

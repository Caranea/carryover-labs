import { HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { ExtractionService, sourceKindOf } from '../extraction/extraction.service';
import { applyDetections, NORMAL, PagePredictions, STRICT } from '../pii/detect';
import { NerService } from '../pii/ner.service';
import { fileNameHints, sanitizeFileName } from '../pii/rules';
import { isNumericValue, normalizeToken } from '../pii/text-utils';
import { applyRegion, buildManifest, burnPage, fromTuple, redactionPlan, removeRegion } from '../redaction/burn';
import { intersects } from '../redaction/geometry';
import { DocumentsApi } from './documents-api';
import { Box, LocalDocument, PrivacyMode, SavedDocumentSummary, WorkingPage, WorkingWord } from './models';

/**
 * Holds every document being prepared on this device and the list of
 * documents saved to the account. Files are processed one at a time so a
 * phone does not run out of memory.
 */
@Injectable({ providedIn: 'root' })
export class DocumentQueueService {
  private readonly extraction = inject(ExtractionService);
  private readonly ner = inject(NerService);
  private readonly api = inject(DocumentsApi);
  private readonly auth = inject(AuthService);

  readonly documents = signal<LocalDocument[]>([]);
  readonly saved = signal<SavedDocumentSummary[] | null>(null);
  readonly savedError = signal<string | null>(null);

  readonly pending = computed(() => this.documents().filter((d) => d.status !== 'saved'));

  private predictions = new Map<string, PagePredictions[]>();
  private running = false;
  private counter = 0;
  private readonly activeChecks = new Map<string, AbortController>();
  private accountId = this.auth.userId();
  private sessionRevision = this.auth.sessionRevision();
  private accountVersion = 0;

  constructor() {
    effect(() => {
      const accountId = this.auth.userId();
      const revision = this.auth.sessionRevision();
      untracked(() => this.syncAccount(accountId, revision));
    });
  }

  /** Never retain one person's working originals or cached list for another session. */
  private syncAccount(accountId = this.auth.userId(), revision = this.auth.sessionRevision()) {
    if (accountId === this.accountId && revision === this.sessionRevision) return;
    this.accountId = accountId;
    this.sessionRevision = revision;
    this.accountVersion++;
    for (const abort of this.activeChecks.values()) abort.abort();
    this.activeChecks.clear();
    for (const doc of this.documents()) revokePages(doc.pages);
    this.documents.set([]);
    this.predictions.clear();
    this.saved.set(null);
    this.savedError.set(null);
  }

  private currentAccount(version: number) {
    this.syncAccount();
    return version === this.accountVersion;
  }

  byId(localId: string): LocalDocument | undefined {
    return this.documents().find((d) => d.localId === localId);
  }

  // ---------------------------------------------------------------------------
  // Adding and processing files
  // ---------------------------------------------------------------------------

  add(files: Iterable<File>, privacyMode: PrivacyMode = 'automatic'): string[] {
    this.syncAccount();
    const added: LocalDocument[] = [];
    for (const file of files) {
      const kind = sourceKindOf(file);
      added.push({
        localId: `local-${Date.now().toString(36)}-${this.counter++}`,
        name: `Lab document ${this.counter}`,
        fileName: file.name,
        sourceKind: kind ?? 'text',
        status: kind ? 'queued' : 'error',
        strict: false,
        privacyMode,
        privacyAcknowledged: false,
        progress: 0,
        message: kind ? 'Waiting' : '',
        error: kind ? undefined : 'This file type is not supported. Use PDF, a photo, Word (.docx) or text.',
        pages: [],
        file: kind ? file : null,
        addedAt: Date.now(),
      });
    }
    this.documents.update((docs) => [...docs, ...added]);
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
    if (this.running) return;
    this.running = true;
    try {
      let next: LocalDocument | undefined;
      while ((next = this.documents().find((d) => d.status === 'queued'))) {
        await this.process(next);
      }
    } finally {
      this.running = false;
    }
  }

  private async process(doc: LocalDocument) {
    const id = doc.localId;
    const accountVersion = this.accountVersion;
    const abort = new AbortController();
    this.activeChecks.set(id, abort);
    try {
      this.patch(id, { status: 'reading', progress: 0, message: 'Opening' });
      const pages = await this.extraction.extract(doc.file!, (fraction, message) =>
        this.patch(id, { progress: fraction * 0.7, message }),
      );
      if (!this.currentAccount(accountVersion) || !this.byId(id)) return revokePages(pages);

      this.patch(id, { status: 'detecting', progress: 0.7, message: doc.privacyMode === 'lightweight' ? 'Checking common personal-detail patterns' : 'Finding personal details', pages });
      const predictions = doc.privacyMode === 'lightweight' ? pages.map(() => null) : await this.ner.predict(pages, abort.signal);
      if (!this.currentAccount(accountVersion)) return;
      const current = this.byId(id);
      if (!current) return;
      this.predictions.set(id, predictions);
      const detected = applyDetections(current.pages, predictions, NORMAL, fileNameHints(current.fileName));
      this.patch(id, {
        status: 'review',
        progress: 1,
        message: '',
        pages: detected,
        strict: false,
        ...privacyStatus(pages, predictions, current.privacyMode),
      });
    } catch (e) {
      this.patch(id, { status: 'error', error: e instanceof Error ? e.message : String(e), message: '' });
    } finally {
      this.activeChecks.delete(id);
    }
  }

  /** Run detection again with a lower model threshold and wider rules. Hand edits are kept. */
  async rescan(localId: string, strict = true) {
    this.syncAccount();
    const accountVersion = this.accountVersion;
    const doc = this.byId(localId);
    if (!doc || doc.status !== 'review') return;
    const abort = new AbortController();
    this.activeChecks.set(localId, abort);
    this.patch(localId, { status: 'detecting', message: 'Checking again, more strictly' });
    try {
      let predictions = this.predictions.get(localId);
      if (doc.privacyMode === 'lightweight') predictions = doc.pages.map(() => null);
      else if (!predictions || predictions.some((p) => p === null)) {
        this.ner.retry();
        predictions = await this.ner.predict(doc.pages, abort.signal);
        if (!this.currentAccount(accountVersion)) return;
        if (this.byId(localId)) this.predictions.set(localId, predictions);
      }
      const current = this.byId(localId);
      if (!current) return;
      const pages = applyDetections(current.pages, predictions, strict ? STRICT : NORMAL, fileNameHints(current.fileName));
      this.patch(localId, { status: 'review', message: '', pages, strict, ...privacyStatus(pages, predictions, current.privacyMode) });
    } catch (e) {
      if (!this.currentAccount(accountVersion)) return;
      this.patch(localId, { status: 'review', message: '', error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.activeChecks.delete(localId);
    }
  }

  /** Download/use the larger local model only after the user explicitly chooses it. */
  async runAutomaticCheck(localId: string) {
    const doc = this.byId(localId);
    if (!doc || doc.status !== 'review') return;
    this.patch(localId, { privacyMode: 'automatic', privacyAcknowledged: false, strict: false });
    this.predictions.delete(localId);
    await this.rescan(localId, true);
  }

  acknowledgePrivacy(localId: string, acknowledged: boolean) {
    if (this.byId(localId)?.status === 'review') this.patch(localId, { privacyAcknowledged: acknowledged, error: undefined });
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
      const target = normalizeToken(word.text);
      const spread = hide && target.length >= 3 && !isNumericValue(word.text);

      return pages.map((page, p) => ({
        ...page,
        words: page.words.map((w): WorkingWord => {
          if (p === pageIndex && w.id === wordId) {
            return hide
              ? { ...w, hidden: true, userSet: true, source: 'you', kind: w.kind ?? 'other' }
              : { ...w, hidden: false, userSet: true, source: undefined, kind: undefined };
          }
          if (spread && !w.hidden && !w.userSet && w.text !== null && normalizeToken(w.text) === target) {
            return { ...w, hidden: true, source: 'you', kind: word.kind ?? 'other' };
          }
          return w;
        }),
      }));
    });
  }

  addRegion(localId: string, pageIndex: number, region: Box) {
    if (region.w < 4 || region.h < 4) return;
    this.updatePages(localId, (pages) => pages.map((p, i) => (i === pageIndex ? applyRegion(p, region) : p)));
  }

  removeRegion(localId: string, pageIndex: number, regionIndex: number) {
    this.updatePages(localId, (pages) =>
      pages.map((p, i) =>
        i === pageIndex && regionIndex >= (p.lockedRegions ?? 0) ? removeRegion(p, regionIndex) : p,
      ),
    );
  }

  rename(localId: string, name: string) {
    this.patch(localId, { name: name.slice(0, 120) });
  }

  remove(localId: string) {
    this.activeChecks.get(localId)?.abort();
    this.activeChecks.delete(localId);
    const doc = this.byId(localId);
    if (doc) revokePages(doc.pages);
    this.predictions.delete(localId);
    this.documents.update((docs) => docs.filter((d) => d.localId !== localId));
  }

  // ---------------------------------------------------------------------------
  // Saving to the account
  // ---------------------------------------------------------------------------

  async approve(localId: string): Promise<boolean> {
    this.syncAccount();
    const accountVersion = this.accountVersion;
    const doc = this.byId(localId);
    if (!doc || doc.status !== 'review') return false;
    if (doc.privacyCheck === 'incomplete' && !doc.privacyAcknowledged) {
      this.patch(localId, { error: 'Confirm that you checked every page yourself. The automatic privacy check was incomplete.' });
      return false;
    }
    const name = doc.name.trim() || 'Document';
    const hiddenText = doc.pages.flatMap((page) => [...redactionPlan(page).hidden].map((index) => page.words[index].text).filter((text): text is string => text !== null));
    const safeName = sanitizeFileName(`${name}.txt`, hiddenText);
    if (safeName !== name || /@|\b\d[\d\s-]{6,}\b/.test(name)) {
      this.patch(localId, { error: 'The document name may contain personal details. Use a general name such as Thyroid tests.' });
      return false;
    }
    this.patch(localId, { status: 'saving', message: 'Blacking out hidden details', error: undefined });
    try {
      const images: (Blob | null)[] = [];
      for (const page of doc.pages) {
        images.push(await burnPage(page));
        if (!this.currentAccount(accountVersion) || !this.byId(localId)) return false;
      }
      const manifest = buildManifest(doc, name);
      this.patch(localId, { message: 'Saving to your account' });
      const summary = doc.serverId
        ? await this.api.replace(doc.serverId, manifest, images)
        : await this.api.create(manifest, images);
      if (!this.currentAccount(accountVersion) || !this.byId(localId)) return false;
      // The originals are no longer needed on this device either.
      revokePages(this.byId(localId)?.pages ?? []);
      this.patch(localId, { status: 'saved', serverId: summary.id, message: '', file: null, pages: [] });
      this.upsertSaved(summary);
      this.predictions.delete(localId);
      return true;
    } catch (e) {
      if (!this.currentAccount(accountVersion)) return false;
      this.patch(localId, { status: 'review', message: '', error: describeHttpError(e) });
      return false;
    }
  }

  /** Open a saved document to hide more. Hidden parts stay hidden; they are not on the server anymore. */
  async openSaved(serverId: string): Promise<string> {
    this.syncAccount();
    const accountVersion = this.accountVersion;
    const existing = this.documents().find((d) => d.serverId === serverId && d.status === 'review');
    if (existing) return existing.localId;

    const doc = await this.api.get(serverId);
    if (!this.currentAccount(accountVersion)) throw new Error('Your account changed. Open the document again after signing in.');
    const pages: WorkingPage[] = [];
    let nextId = 0;
    try {
      for (const p of doc.pages) {
        const image = p.hasImage ? await this.api.pageImage(serverId, p.index) : null;
        if (!this.currentAccount(accountVersion)) throw new Error('Your account changed. Open the document again after signing in.');
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
        fileName: doc.name,
        sourceKind: doc.sourceKind,
        status: 'review',
        strict: false,
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
    this.syncAccount();
    const accountVersion = this.accountVersion;
    try {
      this.savedError.set(null);
      const list = await this.api.list();
      if (this.currentAccount(accountVersion)) this.saved.set(list);
    } catch (e) {
      if (this.currentAccount(accountVersion)) this.savedError.set(describeHttpError(e));
    }
  }

  async deleteSaved(serverId: string) {
    this.syncAccount();
    const accountVersion = this.accountVersion;
    await this.api.delete(serverId);
    if (!this.currentAccount(accountVersion)) return;
    this.saved.update((list) => list?.filter((d) => d.id !== serverId) ?? null);
    for (const d of this.documents().filter((x) => x.serverId === serverId)) this.remove(d.localId);
  }

  private upsertSaved(summary: SavedDocumentSummary) {
    this.saved.update((list) => [summary, ...(list ?? []).filter((d) => d.id !== summary.id)]);
  }

  // ---------------------------------------------------------------------------

  private patch(localId: string, patch: Partial<LocalDocument>) {
    this.documents.update((docs) => docs.map((d) => (d.localId === localId ? { ...d, ...patch } : d)));
  }

  private updatePages(localId: string, fn: (pages: WorkingPage[]) => WorkingPage[]) {
    this.documents.update((docs) =>
      docs.map((d) => (d.localId === localId && d.status === 'review' ? { ...d, pages: fn(d.pages), privacyAcknowledged: false } : d)),
    );
  }
}

function revokePages(pages: WorkingPage[]) {
  for (const p of pages) if (p.imageUrl) URL.revokeObjectURL(p.imageUrl);
}

function privacyStatus(pages: WorkingPage[], predictions: PagePredictions[], mode: PrivacyMode = 'automatic'): Pick<LocalDocument, 'privacyCheck' | 'privacyMessage' | 'privacyAcknowledged'> {
  if (mode === 'lightweight') return { privacyCheck: 'incomplete', privacyAcknowledged: false, privacyMessage: 'Lightweight review uses common patterns only. The full name and address detector was not run. Read every page yourself and hide names, addresses, identification numbers, stamps and signatures before saving.' };
  const incomplete = pages.some((page, i) => {
    const hasText = page.words.some((w) => w.text !== null);
    return (hasText && !predictions[i]) || (!!page.image && !hasText);
  });
  return incomplete
    ? { privacyCheck: 'incomplete', privacyAcknowledged: false, privacyMessage: 'The automatic privacy check was incomplete. Built-in patterns were used. Check names, addresses, identification numbers, stamps and signatures on every page before saving.' }
    : { privacyCheck: 'complete', privacyAcknowledged: false, privacyMessage: 'Automatic checks finished. They can still miss details, so check each page before saving.' };
}

export function describeHttpError(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    const serverMessage = typeof e.error === 'object' && e.error?.message;
    if (e.status === 0) return 'The server could not be reached. Check your connection and try again.';
    if (e.status === 401) return 'Your session has ended. Sign in again and retry.';
    if (serverMessage) return Array.isArray(serverMessage) ? serverMessage.join(' ') : String(serverMessage);
    if (e.status === 413) return 'This document is too large to save.';
    if (e.status === 429) return 'Too many requests at once. Wait a minute, then try again.';
    return `Saving failed (${e.status}).`;
  }
  return e instanceof Error ? e.message : String(e);
}

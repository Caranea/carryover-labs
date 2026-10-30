import { extractDocument } from '../../../api/src/results/extract';
import { parseNumber, toIsoDate } from '../../../api/src/results/tokens';
import { buildRecords } from '../../../api/src/records/build-core';
import { verifyEvidence } from '../../../api/src/recovery/verify-core';
import type { DocumentManifest, SavedDocument, SavedDocumentSummary } from './models';
import type { RecordsResponse } from './records';
import type { CorrectionRequest, Observation, ObservationFields, ResultsResponse } from './results';
import type { RecoveryResponse } from './recovery';
import { deleteApprovedImages, getApprovedImage, putApprovedImages } from './device-storage';

export const LOCAL_HISTORY_KEY = 'carryover.demo.history.v1';
interface Entry {
  document: SavedDocument;
  /** Kept outside document so recovery and results requests cannot include it. */
  originalFileName?: string;
  /** Local idempotency key: reconnect an approval if refresh interrupted queue saving. */
  sourceLocalId?: string;
  observations: Observation[];
  images: Record<string, string>;
  /** New page images use binary storage; images above remains readable for older saves. */
  imageRefs?: Record<string, string>;
  revision: string;
  recovery?: RecoveryResponse;
}
interface HistoryState { version: 1; entries: Entry[]; modelRecords?: { fingerprint: string; records: RecordsResponse } }

/** Atomic localStorage metadata references page blobs committed to IndexedDB first. */
export class LocalHistory {
  approvedQueueDocuments(): Map<string, SavedDocumentSummary> {
    return new Map(read().filter(entry => entry.sourceLocalId).map(entry => [entry.sourceLocalId!, summary(entry.document, entry.originalFileName)]));
  }
  recordSnapshot() {
    const all = read();
    return { fingerprint: fingerprint(all), documents: all.map(({ document, observations }) => ({ id: document.id, name: document.name, observations })), issues: issues(all) };
  }

  cachedModelRecords(): RecordsResponse | null {
    const state = readState();
    return state.modelRecords?.fingerprint === fingerprint(state.entries) ? state.modelRecords.records : null;
  }

  saveModelRecords(expected: string, records: RecordsResponse): boolean {
    const all = read();
    if (fingerprint(all) !== expected) return false;
    write(all, { fingerprint: expected, records });
    return true;
  }

  recoverySnapshot(id: string) {
    const { document, observations, revision, recovery } = find(read(), id);
    return { document, observations, revision, recovery };
  }

  saveRecovery(id: string, revision: string, recovery: RecoveryResponse): boolean {
    const state = readState();
    const entry = state.entries.find((item) => item.document.id === id);
    if (!entry || entry.revision !== revision) return false;
    entry.recovery = recovery;
    write(state.entries, state.modelRecords);
    return true;
  }

  decideRecovery(id: string, proposalId: string, expectedRevision: string, action: 'accepted' | 'rejected', note = ''): RecoveryResponse {
    const all = read();
    const entry = find(all, id);
    const response = entry.recovery;
    const proposal = response?.proposals.find((item) => item.id === proposalId);
    if (!response || !proposal || proposal.state !== 'pending' || proposal.revision !== expectedRevision) throw new Error('This suggestion changed. Reopen it before continuing.');
    if (action === 'accepted') {
      if (!note.trim() || note.trim().length > 500) throw new Error('Write a short note describing what you checked.');
      const verified = verifyEvidence(entry.document, proposal.page, proposal.evidence, entry.observations);
      if (!verified.ok) throw new Error('This suggestion no longer matches the source. Reopen the document.');
      entry.observations.push({ ...verified.observation, id: `${id}:recovery:${proposal.id}`, confirmed: true, revision: crypto.randomUUID(),
        recovery: { proposalId: proposal.id, sourceRevision: response.sourceRevision, model: response.modelName ?? 'Meta AI', acceptedAt: new Date().toISOString(), note: note.trim(), evidence: proposal.evidence } });
    }
    proposal.state = action; proposal.note = note.trim() || null; proposal.decidedAt = new Date().toISOString(); proposal.revision = crypto.randomUUID();
    response.updatedAt = proposal.decidedAt;
    entry.revision = crypto.randomUUID();
    write(all);
    return response;
  }

  async list(): Promise<SavedDocumentSummary[]> {
    return read().map(({ document, originalFileName }) => summary(document, originalFileName));
  }

  async get(id: string): Promise<SavedDocument> {
    const { document, originalFileName } = find(read(), id);
    return { ...document, ...summary(document, originalFileName) };
  }

  async pageImage(id: string, index: number): Promise<Blob> {
    const entry = find(read(), id);
    const ref = entry.imageRefs?.[String(index)];
    if (ref) return getApprovedImage(ref);
    const data = entry.images[String(index)];
    if (!data) throw new Error('This page image is no longer saved on this device.');
    const [prefix, encoded] = data.split(',', 2);
    const mime = /^data:([^;]+);base64$/.exec(prefix)?.[1];
    if (!mime || !encoded) throw new Error('This saved page image could not be read.');
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }

  async create(manifest: DocumentManifest, images: (Blob | null)[], originalFileName?: string, sourceLocalId?: string): Promise<SavedDocumentSummary> {
    const existing = sourceLocalId ? read().find(entry => entry.sourceLocalId === sourceLocalId) : undefined;
    if (existing) return summary(existing.document, existing.originalFileName);
    const now = new Date().toISOString();
    const document: SavedDocument = {
      ...safeManifest(manifest), id: crypto.randomUUID(), pageCount: manifest.pages.length,
      createdAt: now, updatedAt: now,
    };
    const entry = await prepare(document, images);
    if (originalFileName) entry.originalFileName = originalFileName;
    if (sourceLocalId) entry.sourceLocalId = sourceLocalId;
    try {
      // Read after binary saving finishes so concurrent saves retain each other's work.
      const current = read();
      const concurrent = sourceLocalId ? current.find(item => item.sourceLocalId === sourceLocalId) : undefined;
      if (concurrent) { await cleanImages(entry); return summary(concurrent.document, concurrent.originalFileName); }
      write([entry, ...current]);
    } catch (error) { await cleanImages(entry); throw error; }
    return summary(document, entry.originalFileName);
  }

  async replace(id: string, manifest: DocumentManifest, images: (Blob | null)[]): Promise<SavedDocumentSummary> {
    const previous = find(read(), id);
    const safe = safeManifest(manifest);
    preserveHidden(previous.document, safe);
    const document: SavedDocument = {
      ...previous.document, ...safe, pageCount: safe.pages.length, updatedAt: new Date().toISOString(),
    };
    const replacement = await prepare(document, images);
    replacement.originalFileName = previous.originalFileName;
    replacement.sourceLocalId = previous.sourceLocalId;
    try {
      const all = read();
      if (find(all, id).revision !== previous.revision) throw new Error('This document changed. Reopen it before saving.');
      write(all.map((entry) => entry.document.id === id ? replacement : entry));
    } catch (error) { await cleanImages(replacement); throw error; }
    await cleanImages(previous);
    return summary(document, replacement.originalFileName);
  }

  async results(): Promise<ResultsResponse> {
    const all = read();
    return {
      documents: all.map(({ document, observations }) => ({
        id: document.id, name: document.name, sourceKind: document.sourceKind,
        pageCount: document.pageCount, locale: extractDocument(document).locale, count: observations.length,
      })),
      observations: all.flatMap((entry) => entry.observations),
      issues: issues(all),
    };
  }

  async records(): Promise<RecordsResponse> {
    const all = read();
    const { records } = buildRecords(
      all.map(({ document, observations }) => ({ id: document.id, name: document.name, observations, review: null })),
      { version: 1, names: {}, tests: [], conversions: {} }, false,
    );
    return { ...records, issues: issues(all), model: { state: 'off', name: null, waiting: 0, message: null } };
  }

  async correct(documentId: string, observationId: string, request: CorrectionRequest): Promise<Observation> {
    const change = validateCorrection(request);
    const all = read();
    const entry = find(all, documentId);
    const observation = entry.observations.find((o) => o.id === observationId);
    if (!observation || observation.revision !== change.expectedRevision) throw new Error('This reading changed. Reopen it and try again.');
    if ((observation.corrections?.length ?? 0) >= 100) throw new Error('This reading has reached its correction history limit.');
    const changes: Partial<ObservationFields> = {};
    for (const field of ['name', 'valueText', 'unit', 'date'] as const) {
      if (observation[field] !== change[field]) Object.assign(changes, { [field]: change[field] });
    }
    const parsed = parseNumber(change.valueText);
    const updated: Observation = {
      ...observation,
      original: observation.original ?? { name: observation.name, valueText: observation.valueText, unit: observation.unit, date: observation.date },
      ...changes, value: parsed?.value ?? null, comparator: parsed?.comparator ?? null, confirmed: true,
      dateSource: Object.hasOwn(changes, 'date') ? (change.date ? 'user' : null) : observation.dateSource,
      corrections: [...(observation.corrections ?? []), { at: new Date().toISOString(), note: change.note, changes }],
      revision: crypto.randomUUID(),
    };
    entry.observations = entry.observations.map((o) => o.id === observationId ? updated : o);
    entry.revision = crypto.randomUUID();
    write(all);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const entries = read();
    const removed = entries.find(entry => entry.document.id === id);
    write(entries.filter((entry) => entry.document.id !== id));
    if (removed) await cleanImages(removed);
  }
}

function fingerprint(entries: Entry[]): string { return JSON.stringify(entries.map((entry) => [entry.document.id, entry.revision])); }
function read(): Entry[] { return readState().entries; }
function readState(): HistoryState {
  let raw: string | null;
  try { raw = localStorage.getItem(LOCAL_HISTORY_KEY); }
  catch { throw new Error('Browser storage is unavailable. Allow site storage to use saved results.'); }
  if (raw === null) return { version: 1, entries: [] };
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.entries) || !value.entries.every(validEntry)) throw new Error();
    return value;
  } catch { throw new Error('Saved history could not be read. Existing data has been kept; try reopening this browser.'); }
}

function validEntry(value: any): value is Entry {
  const doc = value?.document;
  return typeof value?.revision === 'string' && typeof doc?.id === 'string' && typeof doc.name === 'string'
    && ['pdf', 'image', 'docx', 'text'].includes(doc.sourceKind) && Array.isArray(doc.pages)
    && doc.pages.every((page: any) => Number.isInteger(page?.index) && Array.isArray(page.words) && Array.isArray(page.regions))
    && Array.isArray(value.observations) && value.observations.every((o: any) => typeof o?.id === 'string' && o.documentId === doc.id && typeof o.name === 'string' && typeof o.valueText === 'string')
    && value.images && typeof value.images === 'object' && !Array.isArray(value.images)
    && Object.values(value.images).every((image) => typeof image === 'string')
    && (value.imageRefs === undefined || (value.imageRefs && typeof value.imageRefs === 'object' && !Array.isArray(value.imageRefs)
      && Object.values(value.imageRefs).every(ref => typeof ref === 'string')));
}

function write(entries: Entry[], modelRecords?: HistoryState['modelRecords']): void {
  try { localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify({ version: 1, entries, modelRecords })); }
  catch { throw new Error('This browser’s local storage is full or unavailable. Delete an old demo document or allow site storage, then try again. Your previous results are unchanged.'); }
}

function find(entries: Entry[], id: string): Entry {
  const entry = entries.find((item) => item.document.id === id);
  if (!entry) throw new Error('This document is no longer saved on this device.');
  return entry;
}

function summary({ pages: _pages, ...rest }: SavedDocument, originalFileName?: string): SavedDocumentSummary {
  return originalFileName ? { ...rest, originalFileName } : rest;
}

function safeManifest(manifest: DocumentManifest): DocumentManifest {
  // Explicit fields prevent browser-only metadata from entering processing payloads.
  const { name, sourceKind, pages, hiddenCount } = manifest;
  const copy = structuredClone({ name, sourceKind, pages, hiddenCount });
  for (const page of copy.pages) for (const word of page.words) if (word.h) word.t = null;
  return copy;
}

function preserveHidden(previous: SavedDocument, next: DocumentManifest): void {
  if (previous.pages.length !== next.pages.length) throw new Error('Saved source pages cannot be replaced. Add a new document instead.');
  previous.pages.forEach((page, index) => {
    const update = next.pages[index];
    if (page.index !== update.index || page.words.length !== update.words.length
      || page.words.some((word, i) => word.h && (!update.words[i].h || update.words[i].t !== null))
      || page.regions.some((region, i) => JSON.stringify(region) !== JSON.stringify(update.regions[i]))) {
      throw new Error('Previously hidden details must stay hidden. Reopen the saved copy and try again.');
    }
  });
}

async function prepare(document: SavedDocument, images: (Blob | null)[]): Promise<Entry> {
  const revision = crypto.randomUUID();
  const imageRefs: Record<string, string> = {};
  const blobs: Record<string, Blob> = {};
  for (let i = 0; i < document.pages.length; i++) {
    if (!document.pages[i].hasImage) continue;
    if (!images[i]) throw new Error('A source page image is missing. Add the document again.');
    const key = `${document.id}/${revision}/${document.pages[i].index}`;
    imageRefs[String(document.pages[i].index)] = key;
    blobs[key] = images[i]!;
  }
  if (Object.keys(blobs).length) await putApprovedImages(blobs);
  return {
    document, images: {}, imageRefs, revision,
    observations: extractDocument(document).observations.map((o) => ({ ...o, revision: crypto.randomUUID() })),
  };
}

async function cleanImages(entry: Entry) {
  // A cleanup failure must not turn a completed save into a failed approval.
  await deleteApprovedImages(Object.values(entry.imageRefs ?? {})).catch(() => {});
}

function issues(entries: Entry[]) {
  return entries.filter((entry) => !entry.observations.length).map(({ document }) => ({
    documentId: document.id, documentName: document.name,
    message: 'No result rows could be read from this document. Check that its pages contain a readable results table.',
  }));
}

function validateCorrection(input: CorrectionRequest): CorrectionRequest {
  const text = (value: string, label: string, limit: number) => {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`${label} must contain between 1 and ${limit} characters.`);
    }
    return value.trim();
  };
  const change = {
    name: text(input.name, 'Test name', 200), valueText: text(input.valueText, 'Result', 100),
    unit: input.unit === null ? null : text(input.unit, 'Unit', 60),
    date: input.date === null ? null : text(input.date, 'Date', 10),
    note: text(input.note, 'Note', 500), expectedRevision: input.expectedRevision,
  };
  if (change.date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(change.date) || toIsoDate(change.date, 'YMD') !== change.date)) {
    throw new Error('Enter a valid collection date in YYYY-MM-DD format.');
  }
  if (!parseNumber(change.valueText) && !/^\p{L}/u.test(change.valueText) && !/^\d{1,6}:\d{1,6}$/.test(change.valueText)) {
    throw new Error('Enter the number, comparison or words printed for the result.');
  }
  return change;
}

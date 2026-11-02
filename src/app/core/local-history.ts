import { Injectable } from '@angular/core';
import { parseNumber, toIsoDate } from '@shared/tokens';
import { detectLocale } from '@shared/locale';
import { PROCESSING_VERSION, type PageTranscription } from '@shared/processing';
import type { DocumentManifest, SavedDocument, SavedDocumentSummary } from './models';
import type { RecordsResponse } from '@shared/records';
import type {
  CorrectionRequest,
  Observation,
  ObservationFields,
  ResultsResponse,
} from '@shared/results';
import { deleteApprovedImages, getApprovedImage, putApprovedImages } from './device-storage';

export const LOCAL_HISTORY_KEY = 'carryover.demo.history.v1';
interface Entry {
  document: SavedDocument;
  /** Kept outside document so results requests cannot include it. */
  originalFileName?: string;
  /** Local idempotency key: reconnect an approval if refresh interrupted queue saving. */
  sourceLocalId?: string;
  /** A sample patient document (DEMO_DOCUMENTS id): its pages are read from recorded answers. */
  sample?: string;
  observations: Observation[];
  transcriptions?: Record<string, PageTranscription>;
  images: Record<string, string>;
  /** New page images use binary storage; images above remains readable for older saves. */
  imageRefs?: Record<string, string>;
  revision: string;
}
interface HistoryState {
  version: 1;
  entries: Entry[];
  modelRecords?: { version?: number; fingerprint: string; records: RecordsResponse };
}

/**
 * The browser-only store of approved documents and their results. Metadata lives in
 * localStorage; page images are committed to IndexedDB first.
 */
@Injectable({ providedIn: 'root' })
export class LocalHistory {
  approvedQueueDocuments(): Map<string, SavedDocumentSummary> {
    return new Map(
      read()
        .filter((entry) => entry.sourceLocalId)
        .map((entry) => [entry.sourceLocalId!, summary(entry.document, entry.originalFileName)]),
    );
  }
  recordSnapshot() {
    const all = read();
    return {
      fingerprint: fingerprint(all),
      sources: all.flatMap((entry) =>
        entry.document.pages
          .filter((page) => entry.transcriptions?.[page.index]?.version !== PROCESSING_VERSION)
          .map((page) => ({
            documentId: entry.document.id,
            page: page.index,
            pageId: `${entry.document.id}:${page.index}`,
            revision: entry.revision,
            ...(entry.sample ? { sample: `${entry.sample}:${page.index}` } : {}),
          })),
      ),
      documents: all.map(({ document, observations, transcriptions }) => ({
        id: document.id,
        name: 'Lab document',
        // Header, footer and notes dates from every page: normalization dates rows with them.
        dates: Object.values(transcriptions ?? {}).flatMap((page) => page.dates ?? []),
        observations: observations.map((o) => ({
          id: o.id,
          documentId: o.documentId,
          page: o.page,
          bbox: o.bbox,
          name: o.name,
          valueText: o.valueText,
          unit: o.unit,
          date: o.date,
          dateSource: o.dateSource,
          refText: o.refText,
          flag: o.flag,
          sourceImage: o.sourceImage,
          transcription: o.transcription,
          confirmed: o.confirmed,
          revision: o.revision,
        })),
      })),
    };
  }

  pageSourceCurrent(id: string, revision: string, page: number): boolean {
    const entry = read().find((item) => item.document.id === id);
    return (
      !!entry &&
      entry.revision === revision &&
      entry.document.pages.some((p) => p.index === page) &&
      entry.transcriptions?.[page]?.version !== PROCESSING_VERSION
    );
  }

  savePageProcessing(id: string, expectedRevision: string, result: PageTranscription): boolean {
    const all = read(),
      entry = all.find((item) => item.document.id === id);
    if (!entry || entry.revision !== expectedRevision) return false;
    const page = entry.document.pages.find((p) => p.index === result.page);
    if (
      !page ||
      result.version !== PROCESSING_VERSION ||
      result.documentId !== id ||
      result.pageId !== `${id}:${result.page}` ||
      result.revision !== expectedRevision ||
      !Array.isArray(result.rows) ||
      !Array.isArray(result.observations) ||
      result.rows.length !== result.observations.length ||
      !Array.isArray(result.dates) ||
      result.observations.some(
        (o, index) =>
          o.documentId !== id ||
          o.page !== result.page ||
          o.id !== `${result.pageId}:${index}` ||
          o.sourceImage?.pageId !== result.pageId ||
          o.sourceImage?.revision !== expectedRevision ||
          o.sourceImage?.row !== index ||
          JSON.stringify(o.transcription) !== JSON.stringify(result.rows[index]) ||
          typeof o.name !== 'string' ||
          typeof o.valueText !== 'string',
      )
    ) {
      throw new Error('The page response is incomplete. Please try again.');
    }
    entry.transcriptions = { ...entry.transcriptions, [result.page]: result };
    // Raw transcription stays immutable; reviewed corrections are a separate representation.
    const confirmed = entry.observations.filter((o) => o.confirmed && o.page === result.page);
    entry.observations = [
      ...entry.observations.filter((o) => o.page !== result.page),
      ...result.observations.filter((o) => !confirmed.some((old) => old.id === o.id)),
      ...confirmed,
    ];
    if (/^Lab document(?: \d+)?$/.test(entry.document.name) && result.suggestedName)
      entry.document.name = result.suggestedName.slice(0, 100);
    write(all);
    return true;
  }

  cachedModelRecords(): RecordsResponse | null {
    const state = readState();
    return state.modelRecords?.version === PROCESSING_VERSION &&
      state.modelRecords.fingerprint === fingerprint(state.entries)
      ? structuredClone(state.modelRecords.records)
      : null;
  }

  saveModelRecords(expected: string, records: RecordsResponse): boolean {
    const all = read();
    if (fingerprint(all) !== expected) return false;
    // Reattach local display titles after inference, without sending custom names to the server.
    const names = new Map(all.map((entry) => [entry.document.id, entry.document.name]));
    const points = records.domains.flatMap((domain) =>
      domain.charts.flatMap((chart) => chart.series.flatMap((series) => series.points)),
    );
    for (const source of [
      ...points,
      ...points.flatMap((point) => point.alsoIn),
      ...records.textResults,
      ...records.warnings,
    ]) {
      source.documentName = names.get(source.documentId) ?? source.documentName;
    }
    write(all, { version: PROCESSING_VERSION, fingerprint: expected, records });
    return true;
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
    if (!data)
      throw new Error(
        entry.document.pages[index]?.hasImage
          ? 'This page image is no longer saved on this device.'
          : 'This older text-only source has no page image. Add the file again, then review and approve it.',
      );
    const [prefix, encoded] = data.split(',', 2);
    const mime = /^data:([^;]+);base64$/.exec(prefix)?.[1];
    if (!mime || !encoded) throw new Error('This saved page image could not be read.');
    const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    return new Blob([bytes], { type: mime });
  }

  async create(
    manifest: DocumentManifest,
    images: (Blob | null)[],
    originalFileName?: string,
    sourceLocalId?: string,
    sample?: string,
  ): Promise<SavedDocumentSummary> {
    const existing = sourceLocalId
      ? read().find((entry) => entry.sourceLocalId === sourceLocalId)
      : undefined;
    if (existing) return summary(existing.document, existing.originalFileName);
    const now = new Date().toISOString();
    const document: SavedDocument = {
      ...safeManifest(manifest),
      id: crypto.randomUUID(),
      pageCount: manifest.pages.length,
      createdAt: now,
      updatedAt: now,
    };
    const entry = await prepare(document, images);
    if (originalFileName) entry.originalFileName = originalFileName;
    if (sourceLocalId) entry.sourceLocalId = sourceLocalId;
    if (sample) entry.sample = sample;
    try {
      // Read after binary saving finishes so concurrent saves retain each other's work.
      const current = read();
      const concurrent = sourceLocalId
        ? current.find((item) => item.sourceLocalId === sourceLocalId)
        : undefined;
      if (concurrent) {
        await cleanImages(entry);
        return summary(concurrent.document, concurrent.originalFileName);
      }
      write([entry, ...current]);
    } catch (error) {
      await cleanImages(entry);
      throw error;
    }
    return summary(document, entry.originalFileName);
  }

  async replace(
    id: string,
    manifest: DocumentManifest,
    images: (Blob | null)[],
  ): Promise<SavedDocumentSummary> {
    const previous = find(read(), id);
    const safe = safeManifest(manifest);
    preserveHidden(previous.document, safe);
    const document: SavedDocument = {
      ...previous.document,
      ...safe,
      pageCount: safe.pages.length,
      updatedAt: new Date().toISOString(),
    };
    const replacement = await prepare(document, images);
    replacement.originalFileName = previous.originalFileName;
    replacement.sourceLocalId = previous.sourceLocalId;
    replacement.sample = previous.sample;
    try {
      const all = read();
      if (find(all, id).revision !== previous.revision)
        throw new Error('This document changed. Reopen it before saving.');
      write(all.map((entry) => (entry.document.id === id ? replacement : entry)));
    } catch (error) {
      await cleanImages(replacement);
      throw error;
    }
    await cleanImages(previous);
    return summary(document, replacement.originalFileName);
  }

  async results(): Promise<ResultsResponse> {
    const all = read();
    return {
      documents: all.map(({ document, observations }) => ({
        id: document.id,
        name: document.name,
        sourceKind: document.sourceKind,
        pageCount: document.pageCount,
        locale: {
          // Worked out on this device from the visible words; it labels printed names only.
          language: detectLocale(document.pages).language,
          decimal: '.',
          dateOrder: 'DMY',
          collectionDate: null,
          collectionDateSource: null,
        },
        count: observations.length,
      })),
      // A copy: the parsed history is cached, and callers must not change it by accident.
      observations: structuredClone(all.flatMap((entry) => entry.observations)),
    };
  }

  /** The last processed results, when they still match the saved documents. */
  async savedRecords(): Promise<RecordsResponse> {
    const cached = this.cachedModelRecords();
    if (cached) return cached;
    if (read().length) throw new Error('Results need server processing. Open Results to continue.');
    return {
      domains: [],
      textResults: [],
      warnings: [],
      stats: { documents: 0, tests: 0, values: 0, from: null, to: null },
      model: { state: 'ready', name: null, waiting: 0, message: null },
    };
  }

  async correct(
    documentId: string,
    observationId: string,
    request: CorrectionRequest,
  ): Promise<Observation> {
    const change = validateCorrection(request);
    const all = read();
    const entry = find(all, documentId);
    const observation = entry.observations.find((o) => o.id === observationId);
    if (!observation || observation.revision !== change.expectedRevision)
      throw new Error('This reading changed. Reopen it and try again.');
    if ((observation.corrections?.length ?? 0) >= 100)
      throw new Error('This reading has reached its correction history limit.');
    const changes: Partial<ObservationFields> = {};
    for (const field of ['name', 'valueText', 'unit', 'date'] as const) {
      if (observation[field] !== change[field]) Object.assign(changes, { [field]: change[field] });
    }
    const parsed = parseNumber(change.valueText);
    const updated: Observation = {
      ...observation,
      original: observation.original ?? {
        name: observation.name,
        valueText: observation.valueText,
        unit: observation.unit,
        date: observation.date,
      },
      ...changes,
      value: parsed?.value ?? null,
      comparator: parsed?.comparator ?? null,
      confirmed: true,
      dateSource: Object.hasOwn(changes, 'date')
        ? change.date
          ? 'user'
          : null
        : observation.dateSource,
      corrections: [
        ...(observation.corrections ?? []),
        { at: new Date().toISOString(), note: change.note, changes },
      ],
      revision: crypto.randomUUID(),
    };
    entry.observations = entry.observations.map((o) => (o.id === observationId ? updated : o));
    entry.revision = crypto.randomUUID();
    write(all);
    return updated;
  }

  async delete(id: string): Promise<void> {
    const entries = read();
    const removed = entries.find((entry) => entry.document.id === id);
    write(entries.filter((entry) => entry.document.id !== id));
    if (removed) await cleanImages(removed);
  }
}

function fingerprint(entries: Entry[]): string {
  return JSON.stringify([
    PROCESSING_VERSION,
    entries.map((entry) => [entry.document.id, entry.revision]),
  ]);
}
function read(): Entry[] {
  return readState().entries;
}

/**
 * The last state read or written, with the exact text it came from. The results loop reads the
 * history several times per poll; parsing megabytes each time is the cost this avoids. Reading
 * the text back is cheap, and comparing it notices a change made in another tab.
 */
let parsed: { raw: string; state: HistoryState } | null = null;

function readState(): HistoryState {
  let raw: string | null;
  try {
    raw = localStorage.getItem(LOCAL_HISTORY_KEY);
  } catch {
    throw new Error('Browser storage is unavailable. Allow site storage to use saved results.');
  }
  if (raw === null) {
    parsed = null;
    return { version: 1, entries: [] };
  }
  if (parsed?.raw === raw) return parsed.state;
  try {
    const value = JSON.parse(raw);
    if (value.version !== 1 || !Array.isArray(value.entries) || !value.entries.every(validEntry))
      throw new Error();
    parsed = { raw, state: value };
    return value;
  } catch {
    throw new Error(
      'Saved history could not be read. Existing data has been kept; try reopening this browser.',
    );
  }
}

type Fields = Record<string, unknown>;
const isFields = (value: unknown): value is Fields =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isStringMap = (value: unknown) =>
  isFields(value) && Object.values(value).every((v) => typeof v === 'string');

/** A shallow shape check of one saved entry, so corrupted storage fails loudly instead of later. */
function validEntry(value: unknown): value is Entry {
  if (!isFields(value) || typeof value['revision'] !== 'string') return false;
  const doc = value['document'];
  if (!isFields(doc) || typeof doc['id'] !== 'string' || typeof doc['name'] !== 'string')
    return false;
  if (
    !['pdf', 'image', 'docx', 'text'].includes(doc['sourceKind'] as string) ||
    !Array.isArray(doc['pages'])
  )
    return false;
  const pagesValid = doc['pages'].every(
    (page) =>
      isFields(page) &&
      Number.isInteger(page['index']) &&
      Array.isArray(page['words']) &&
      Array.isArray(page['regions']),
  );
  const observations = value['observations'];
  const observationsValid =
    Array.isArray(observations) &&
    observations.every(
      (o) =>
        isFields(o) &&
        typeof o['id'] === 'string' &&
        o['documentId'] === doc['id'] &&
        typeof o['name'] === 'string' &&
        typeof o['valueText'] === 'string',
    );
  return (
    pagesValid &&
    observationsValid &&
    isStringMap(value['images']) &&
    (value['imageRefs'] === undefined || isStringMap(value['imageRefs'])) &&
    (value['sample'] === undefined || typeof value['sample'] === 'string')
  );
}

function write(entries: Entry[], modelRecords?: HistoryState['modelRecords']): void {
  const state: HistoryState = { version: 1, entries, modelRecords };
  const raw = JSON.stringify(state);
  try {
    localStorage.setItem(LOCAL_HISTORY_KEY, raw);
    parsed = { raw, state };
  } catch {
    // Callers change entries in place before writing: forget them, the stored text is the truth.
    parsed = null;
    throw new Error(
      'This browser’s local storage is full or unavailable. Delete an old demo document or allow site storage, then try again. Your previous results are unchanged.',
    );
  }
}

function find(entries: Entry[], id: string): Entry {
  const entry = entries.find((item) => item.document.id === id);
  if (!entry) throw new Error('This document is no longer saved on this device.');
  return entry;
}

function summary(
  { pages: _pages, ...rest }: SavedDocument,
  originalFileName?: string,
): SavedDocumentSummary {
  return originalFileName ? { ...rest, originalFileName } : rest;
}

function safeManifest(manifest: DocumentManifest): DocumentManifest {
  // Explicit fields prevent browser-only metadata from entering processing payloads.
  const { name, sourceKind, pages, hiddenCount } = manifest;
  const copy = structuredClone({
    name,
    sourceKind,
    hiddenCount,
    pages: pages.map((page) => ({
      index: page.index,
      width: page.width,
      height: page.height,
      hasImage: page.hasImage,
      ocr: page.ocr,
      regions: page.regions,
      words: page.words.map((word) => ({
        t: word.t,
        l: word.l,
        ...(word.b ? { b: word.b } : {}),
        ...(word.h ? { h: true as const } : {}),
        ...(word.k ? { k: word.k } : {}),
      })),
    })),
  });
  for (const page of copy.pages) for (const word of page.words) if (word.h) word.t = null;
  return copy;
}

function preserveHidden(previous: SavedDocument, next: DocumentManifest): void {
  if (previous.pages.length !== next.pages.length)
    throw new Error('Saved source pages cannot be replaced. Add a new document instead.');
  previous.pages.forEach((page, index) => {
    const update = next.pages[index];
    if (
      page.index !== update.index ||
      page.words.length !== update.words.length ||
      page.words.some((word, i) => word.h && (!update.words[i].h || update.words[i].t !== null)) ||
      page.regions.some((region, i) => JSON.stringify(region) !== JSON.stringify(update.regions[i]))
    ) {
      throw new Error(
        'Previously hidden details must stay hidden. Reopen the saved copy and try again.',
      );
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
    document,
    images: {},
    imageRefs,
    revision,
    observations: [],
  };
}

async function cleanImages(entry: Entry) {
  // A cleanup failure must not turn a completed save into a failed approval.
  await deleteApprovedImages(Object.values(entry.imageRefs ?? {})).catch(() => {});
}

function validateCorrection(input: CorrectionRequest): CorrectionRequest {
  const text = (value: string, label: string, limit: number) => {
    if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.trim().length > limit ||
      /\p{Cc}/u.test(value)
    ) {
      throw new Error(`${label} must contain between 1 and ${limit} characters.`);
    }
    return value.trim();
  };
  const change = {
    name: text(input.name, 'Test name', 200),
    valueText: text(input.valueText, 'Result', 100),
    unit: input.unit === null ? null : text(input.unit, 'Unit', 60),
    date: input.date === null ? null : text(input.date, 'Date', 10),
    note: text(input.note, 'Note', 500),
    expectedRevision: input.expectedRevision,
  };
  if (
    change.date !== null &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(change.date) || toIsoDate(change.date, 'YMD') !== change.date)
  ) {
    throw new Error('Enter a valid collection date in YYYY-MM-DD format.');
  }
  if (
    !parseNumber(change.valueText) &&
    !/^\p{L}/u.test(change.valueText) &&
    !/^\d{1,6}:\d{1,6}$/.test(change.valueText)
  ) {
    throw new Error('Enter the number, comparison or words printed for the result.');
  }
  return change;
}

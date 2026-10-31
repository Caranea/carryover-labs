import { validateAnswer } from '../records/meta-model.js';
import type { Observation } from '../shared/results.js';
import { parseNumber, toIsoDate } from '../shared/tokens.js';
import type { SourceDocument } from './normalization.js';
import { PROCESSING_VERSION } from '../shared/processing.js';
import { transcriptionSchema } from './source-processing.js';

const LIMITS = { documents: 100, observations: 5000, pages: 40 };
const FLAGS = ['H', 'L', 'HH', 'LL', 'A'] as const;
const rowSchema = { schema: transcriptionSchema.properties.rows.items };

export class InvalidRequest extends Error {}

export interface RecordsRequest {
  batchId: string;
  documents: SourceDocument[];
}

/** Rebuild a records request from known fields only; anything unexpected is rejected or dropped. */
export function parseRecordsRequest(body: unknown): RecordsRequest {
  const input = asObject(body);
  if (input['processingVersion'] !== PROCESSING_VERSION) {
    throw new InvalidRequest('Reprocess the approved pages with the current version.');
  }
  const batchId = input['batchId'];
  if (typeof batchId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(batchId)) {
    throw new InvalidRequest('Invalid batch');
  }
  const documents = input['documents'];
  if (!Array.isArray(documents) || documents.length > LIMITS.documents) {
    throw new InvalidRequest(`Send at most ${LIMITS.documents} documents per check.`);
  }

  const documentIds = new Set<string>();
  const observationIds = new Set<string>();
  const parsed = documents.map((raw): SourceDocument => {
    const doc = asObject(raw);
    const id = text(doc['id'], 100);
    const name = text(doc['name'], 120);
    if (!Array.isArray(doc['observations']) || documentIds.has(id)) throw invalidSnapshot();
    documentIds.add(id);
    const observations = doc['observations'].map((o) => parseObservation(o, id));
    for (const o of observations) {
      if (observationIds.has(o.id) || observationIds.size >= LIMITS.observations)
        throw invalidSnapshot();
      observationIds.add(o.id);
    }
    return { id, name, observations };
  });
  return { batchId, documents: parsed };
}

function parseObservation(raw: unknown, documentId: string): Observation {
  const o = asObject(raw);
  const page = o['page'];
  if (
    o['documentId'] !== documentId ||
    !Number.isInteger(page) ||
    (page as number) < 0 ||
    (page as number) >= LIMITS.pages
  ) {
    throw invalidSnapshot();
  }
  const name = text(o['name'], 200);
  if (!name.trim()) throw invalidSnapshot();
  const valueText = text(o['valueText'], 100, true);
  const unit = nullable(o['unit'], 60);
  const date = nullable(o['date'], 10);
  if (date !== null && toIsoDate(date, 'YMD') !== date) throw invalidSnapshot();

  const number = parseNumber(valueText);
  const sourceImage = asSourceImage(o['sourceImage'], `${documentId}:${page}`);
  const flag = FLAGS.find((f) => f === o['flag']) ?? null;
  const bbox = o['bbox'];
  return {
    id: text(o['id'], 200),
    documentId,
    page: page as number,
    words: [],
    name,
    valueText,
    value: number?.value ?? null,
    comparator: number?.comparator ?? null,
    unit,
    date,
    dateSource: date ? (o['dateSource'] === 'label' ? 'label' : 'user') : null,
    refLow: null,
    refHigh: null,
    refText: typeof o['refText'] === 'string' ? o['refText'].slice(0, 200) : null,
    flag,
    bbox: isBox(bbox) ? bbox : null,
    confirmed: o['confirmed'] === true,
    revision: typeof o['revision'] === 'string' ? o['revision'].slice(0, 100) : undefined,
    ...(o['transcription'] ? { transcription: validateAnswer(rowSchema, o['transcription']) } : {}),
    ...(sourceImage ? { sourceImage } : {}),
  };
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidSnapshot();
  return value as Record<string, unknown>;
}

function text(value: unknown, maxLength: number, allowEmpty = false): string {
  if (typeof value !== 'string' || value.length > maxLength || (!allowEmpty && !value))
    throw invalidSnapshot();
  return value;
}

function nullable(value: unknown, maxLength: number): string | null {
  return value === null ? null : text(value, maxLength);
}

function asSourceImage(value: unknown, pageId: string): Observation['sourceImage'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as NonNullable<Observation['sourceImage']>;
  return source.pageId === pageId ? source : undefined;
}

function isBox(value: unknown): value is [number, number, number, number] {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

function invalidSnapshot(): InvalidRequest {
  return new InvalidRequest('The result snapshot is invalid. Reload your saved results.');
}

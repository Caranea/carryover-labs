import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { CorrectionRequest, Observation, ObservationCorrection, ObservationFields } from './contract.js';
import { parseNumber, toIsoDate } from './tokens.js';

export interface CorrectionLedger {
  version: 1;
  observations: Record<string, { sourceHash: string; entries: ObservationCorrection[] }>;
}

const FIELDS = ['name', 'valueText', 'unit', 'date'] as const;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Corrections are an overlay. The saved source and cached extraction never change. */
export function applyCorrections(source: Observation, ledger: CorrectionLedger | null): Observation {
  const original: ObservationFields = { name: source.name, valueText: source.valueText, unit: source.unit, date: source.date };
  const saved = ledger?.version === 1 ? ledger.observations[source.id] : undefined;
  const sourceHash = hash(source);
  const corrections = saved?.sourceHash === sourceHash ? saved.entries : [];
  const effective = corrections.reduce((fields, entry) => ({ ...fields, ...entry.changes }), original);
  const parsed = parseNumber(effective.valueText);
  return {
    ...source,
    ...effective,
    value: parsed?.value ?? null,
    comparator: parsed?.comparator ?? null,
    dateSource: corrections.some((c) => Object.hasOwn(c.changes, 'date')) ? (effective.date ? 'user' : null) : source.dateSource,
    original,
    corrections,
    revision: hash([sourceHash, corrections]),
    confirmed: source.confirmed === true || corrections.length > 0,
  };
}

export function addCorrection(source: Observation, ledger: CorrectionLedger | null, request: CorrectionRequest): CorrectionLedger {
  const current = applyCorrections(source, ledger);
  if (current.revision !== request.expectedRevision) throw new ConflictException('This reading changed. Reload it before saving your correction.');
  const entries = current.corrections!;
  if (entries.length >= 100) throw new BadRequestException('This reading has reached its correction history limit.');
  const changes: Partial<ObservationFields> = {};
  for (const key of FIELDS) if (current[key] !== request[key]) Object.assign(changes, { [key]: request[key] });
  const next = { ...(ledger?.version === 1 ? ledger.observations : {}) };
  next[source.id] = { sourceHash: hash(source), entries: [...entries, { at: new Date().toISOString(), note: request.note, changes }] };
  return { version: 1, observations: next };
}

export function validateCorrection(body: unknown): CorrectionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Enter the reading and a note explaining what you checked.');
  const data = body as Record<string, unknown>;
  const allowed = [...FIELDS, 'note', 'expectedRevision'];
  if (Object.keys(data).some((key) => !allowed.includes(key))) throw new BadRequestException('The correction contains an unsupported field.');
  const text = (key: string, max: number): string => {
    const value = data[key];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new BadRequestException(`${key} must contain between 1 and ${max} characters.`);
    }
    return value.trim();
  };
  const name = text('name', 200);
  const valueText = text('valueText', 100);
  const unit = data.unit === null ? null : text('unit', 60);
  const date = data.date === null ? null : text('date', 10);
  const note = text('note', 500);
  const expectedRevision = text('expectedRevision', 64);
  if (!/^[a-f0-9]{64}$/.test(expectedRevision)) throw new BadRequestException('Reload this reading before saving a correction.');
  if (date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || toIsoDate(date, 'YMD') !== date)) throw new BadRequestException('Enter a valid collection date in YYYY-MM-DD format.');
  const textResult = /^\p{L}/u.test(valueText) || /^\d{1,6}:\d{1,6}$/.test(valueText);
  if (!parseNumber(valueText) && !textResult) throw new BadRequestException('Enter a number, a comparison such as < 4, or the words printed for the result.');
  return { name, valueText, unit, date, note, expectedRevision };
}

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StorageTestModule as AppModule } from '../testing/storage-test.module.js';
import { loadConfig } from '../config.js';
import type { DocumentManifest } from '../documents/contract.js';
import { DocumentStorage } from '../documents/storage.js';
import { STORAGE } from '../documents/storage.token.js';
import type { RecordsResponse } from '../records/contract.js';
import type { CorrectionRequest, Observation, ResultsResponse } from './contract.js';

function manifest(): DocumentManifest {
  const line = (l: number, cells: string[]) => cells.map((t, i) => ({ t, b: [20 + i * 260, 20 + l * 30, t.length * 8, 18] as [number, number, number, number], l }));
  return { name: 'Synthetic report', sourceKind: 'pdf', hiddenCount: 0, pages: [{ index: 0, width: 1200, height: 300, hasImage: false, ocr: false, regions: [], words: [
    ...line(0, ['Collected', '2024-01-01']),
    ...line(1, ['Test', 'Result', 'Units', 'Range']),
    ...line(2, ['Hemoglobin', '139', 'g/dL', '12-16']),
  ] }] };
}

describe('authenticated source corrections', () => {
  let app: INestApplication, base: string, dir: string, storage: DocumentStorage;
  const auth = (user = 'alice') => ({ Authorization: `Bearer user:${user}`, 'Content-Type': 'application/json' });
  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'carryover-corrections-'));
    const verifier = async (token: string) => {
      if (!token.startsWith('user:')) throw new Error('Invalid test session');
      return { sub: token.slice(5) };
    };
    app = await NestFactory.create(AppModule.forRoot(loadConfig({ STORAGE_DIR: dir }), verifier, null), { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
    storage = app.get<DocumentStorage>(STORAGE);
  });
  after(async () => {
    await app?.close();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const raw = async (user: string) => (await (await fetch(`${base}/results`, { headers: auth(user) })).json()) as ResultsResponse;
  const url = (reading: Observation) => `${base}/results/${reading.documentId}/observations/${encodeURIComponent(reading.id)}`;
  const request = (reading: Observation): CorrectionRequest => ({ name: reading.name, valueText: '13.9', unit: 'g/dL', date: reading.date, note: 'Checked the decimal on the source page.', expectedRevision: reading.revision! });

  it('requires authentication and keeps another account from correcting the source', async () => {
    await storage.create('alice', manifest(), new Map());
    const reading = (await raw('alice')).observations[0];
    assert.equal((await fetch(url(reading), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request(reading)) })).status, 401);
    assert.equal((await fetch(url(reading), { method: 'PATCH', headers: auth('bob'), body: JSON.stringify(request(reading)) })).status, 404);
    assert.equal((await raw('bob')).observations.length, 0);
  });

  it('preserves the original reading and image words while applying a correction to records', async () => {
    const reading = (await raw('alice')).observations[0];
    const sourceBefore = await storage.read('alice', reading.documentId);
    const patched = await fetch(url(reading), { method: 'PATCH', headers: auth(), body: JSON.stringify(request(reading)) });
    assert.equal(patched.status, 200);
    const result = await patched.json() as Observation;
    assert.equal(result.value, 13.9);
    assert.equal(result.original?.valueText, '139');
    assert.equal(result.confirmed, true);
    assert.notEqual(result.revision, reading.revision);
    assert.deepEqual(result.corrections?.[0].changes, { valueText: '13.9' });
    assert.deepEqual(await storage.read('alice', reading.documentId), sourceBefore);
    assert.equal((await storage.readResults('alice', reading.documentId))?.observations[0].valueText, '139');
    const records = await (await fetch(`${base}/records`, { headers: auth() })).json() as RecordsResponse;
    assert.equal(records.stats.values, 1);
    assert.equal(records.domains[0].charts[0].series[0].points[0].value, 13.9);
    assert.equal((await raw('alice')).observations[0].corrections?.length, 1);
  });

  it('serializes concurrent corrections and rejects stale revisions without losing history', async () => {
    const reading = (await raw('alice')).observations[0];
    const body = request(reading);
    const responses = await Promise.all(['13.8', '13.7'].map((valueText) => fetch(url(reading), { method: 'PATCH', headers: auth(), body: JSON.stringify({ ...body, valueText }) })));
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
    const latest = (await raw('alice')).observations[0];
    assert.equal(latest.corrections?.length, 2);
    assert.equal(latest.original?.valueText, '139');
  });

  it('rejects impossible dates, missing notes, unknown fields and invalid values', async () => {
    const reading = (await raw('alice')).observations[0];
    for (const change of [{ date: '2024-02-30' }, { note: '' }, { admin: true }, { valueText: '1,2,3' }, { valueText: '1e999' }, { name: '' }, { unit: 42 }]) {
      const response = await fetch(url(reading), { method: 'PATCH', headers: auth(), body: JSON.stringify({ ...request(reading), ...change }) });
      assert.equal(response.status, 400);
    }
    assert.equal((await raw('alice')).observations[0].revision, reading.revision);
  });

  it('allows unchanged confirmation and cannot restore history after source redaction', async () => {
    await storage.create('confirmation', manifest(), new Map());
    const reading = (await raw('confirmation')).observations[0];
    const response = await fetch(url(reading), { method: 'PATCH', headers: auth('confirmation'), body: JSON.stringify({ ...request(reading), valueText: '139', note: 'The source page really says 139.' }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json() as Observation).corrections?.[0].changes, {});
    const records = await (await fetch(`${base}/records`, { headers: auth('confirmation') })).json() as RecordsResponse;
    assert.equal(records.stats.values, 1);
    const source = manifest();
    source.pages[0].words = source.pages[0].words.map((word) => word.t === 'Hemoglobin' ? { ...word, t: null, h: true as const } : word);
    await storage.replace('confirmation', reading.documentId, source, new Map());
    assert.equal(await storage.readExtra('confirmation', reading.documentId, 'corrections'), null);
    assert.equal((await raw('confirmation')).observations.length, 0);
    assert.equal((await fetch(url(reading), { method: 'PATCH', headers: auth('confirmation'), body: JSON.stringify(request(reading)) })).status, 404);
  });

  it('surfaces extraction failures instead of silently removing the document', async () => {
    const readResults = storage.readResults.bind(storage);
    storage.readResults = async () => { throw new Error('Synthetic cache failure'); };
    try {
      const response = await raw('alice');
      assert.equal(response.issues?.length, 1);
      assert.match(response.issues![0].message, /could not read/i);
      assert.equal(response.observations.length, 0);
    } finally { storage.readResults = readResults; }
  });
});

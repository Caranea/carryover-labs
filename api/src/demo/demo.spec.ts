import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DemoModule } from './demo.module.js';
import type { JsonModel, ModelTask } from '../records/muse.js';
import type { SavedDocument } from '../documents/contract.js';
import { securityHeaders } from '../security/http-security.js';
import type { RecordsResponse } from '../records/contract.js';
import type { RecoveryResponse } from '../recovery/contract.js';

function source(): SavedDocument {
  const word = (t: string, l: number, x: number) => ({ t, l, b: [x, 20 + l * 30, Math.max(12, t.length * 8), 18] as [number, number, number, number] });
  return { id: 'synthetic-document', name: 'PRIVATE-TITLE', sourceKind: 'text', hiddenCount: 1, pageCount: 1,
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    pages: [{ index: 0, width: 1200, height: 500, hasImage: false, ocr: false, regions: [], words: [
      word('Collected', 0, 40), word('2024-01-01', 0, 150), word('TSH', 2, 40),
      word('1,50', 3, 40), word('mIU/L', 3, 130), word('0,35', 3, 240), word('–', 3, 290), word('4,94', 3, 320),
      { t: null, h: true, l: 7, b: [40, 230, 120, 18] },
    ] }] };
}
const evidence = { name: [2], value: [3], unit: [4], date: [1], reference: [5, 6, 7] };

describe('stateless Meta demo API', () => {
  let app: INestApplication, base: string;
  const tasks: ModelTask[] = [];
  let invalid = false;
  const model: JsonModel = { name: 'Synthetic Meta model', async ask<T>(task: ModelTask): Promise<T> {
    tasks.push(task);
    if (invalid) return { unexpected: true } as T;
    if (task.kind === 'recover-source-rows') return { rows: [{ page: 0, ...evidence }, { page: 0, ...evidence, value: [8] }] } as T;
    if (task.kind === 'map-names') return { answers: [{ name: 'Unfamiliar thyroid label', key: 'tsh', newTest: null, notATest: false, reason: 'Synthetic name match' }] } as T;
    return { flags: [] } as T;
  } };
  before(async () => {
    app = await NestFactory.create(DemoModule.forRoot({ models: [] }, model), { logger: false });
    app.setGlobalPrefix('api'); app.use(securityHeaders); await app.listen(0, '127.0.0.1');
    base = `${await app.getUrl()}/api`;
  });
  after(async () => { await app?.close(); });
  const post = (route: string, data: unknown) => fetch(`${base}/demo/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const snapshot = () => ({ documents: [{ id: 'fictional', name: 'PRIVATE-TITLE', observations: [{
    id: 'row', documentId: 'fictional', page: 0, name: 'Unfamiliar thyroid label', valueText: '2.4', value: 999,
    unit: 'mIU/L', date: '2026-01-01', bbox: null,
  }] }] });

  it('works without a session and exposes no stored-document or account routes', async () => {
    const config = await fetch(`${base}/demo/config`);
    assert.equal(config.status, 200); assert.equal((await config.json() as { modelName: string }).modelName, model.name);
    assert.match(config.headers.get('cache-control')!, /no-store/);
    for (const path of ['documents', 'documents/synthetic-document', 'results', 'records', 'recovery/synthetic-document', 'config']) {
      assert.equal((await fetch(`${base}/${path}`)).status, 404, path);
    }
    assert.equal((await fetch(`${base}/documents`, { method: 'POST' })).status, 404);
  });

  it('calls Meta for name matching and review, rebuilds numbers from text, and retains no cross-request history', async () => {
    tasks.length = 0;
    const response = await post('records', snapshot());
    assert.equal(response.status, 201);
    const result = await response.json() as RecordsResponse;
    assert.equal(result.model.state, 'ready'); assert.equal(result.stats.values, 1);
    assert.equal(result.domains.flatMap((d: any) => d.charts).flatMap((c: any) => c.series)[0].points[0].value, 2.4);
    assert.ok(tasks.some((task) => task.kind === 'map-names')); assert.ok(tasks.some((task) => task.kind === 'review'));
    assert.ok(tasks.every((task) => !task.user.includes('PRIVATE-TITLE')));
    const calls = tasks.length;
    await post('records', snapshot());
    assert.equal(tasks.length, calls * 2, 'each request supplies its own history');
    assert.equal((await (await post('records', { documents: [] })).json() as RecordsResponse).stats.values, 0);
  });

  it('returns only source-verified proposals and accepts no hidden text', async () => {
    const response = await post('recovery', { document: source(), page: 0 });
    assert.equal(response.status, 201);
    const answer = await response.json() as RecoveryResponse;
    assert.equal(answer.proposals.length, 1); assert.equal(answer.proposals[0].state, 'pending');
    assert.equal(answer.proposals[0].valueText, '1,50');
    const duplicate = await post('recovery', { document: source(), page: 0, acceptedEvidence: [{ page: 0, evidence }] });
    assert.deepEqual((await duplicate.json() as RecoveryResponse).proposals, []);
    const hidden = source(); hidden.pages[0].words[8].t = 'HIDDEN-SECRET';
    const calls = tasks.length;
    assert.equal((await post('recovery', { document: hidden, page: 0 })).status, 400);
    assert.equal(tasks.length, calls);
  });

  it('rejects malformed input and handles invalid model answers without discarding local readings', async () => {
    const malformed = snapshot(); malformed.documents[0].observations[0].date = '2026-02-30';
    assert.equal((await post('records', malformed)).status, 400);
    invalid = true;
    try {
      const result = await (await post('records', snapshot())).json() as RecordsResponse;
      assert.equal(result.model.state, 'error'); assert.ok(result.warnings.length);
      assert.equal((await post('recovery', { document: source(), page: 0 })).status, 502);
    } finally { invalid = false; }
  });
});

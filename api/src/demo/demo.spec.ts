import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { DemoModule } from './demo.module.js';
import { DemoController } from './demo.controller.js';
import { securityHeaders } from '../security/http-security.js';

describe('stateless image processing API', () => {
  let app: INestApplication, base: string;
  before(async () => {
    app = await NestFactory.create(DemoModule.forRoot({ models: [] }, { name: 'Synthetic Meta', async ask<T>() { return { mappings: [] } as T; } }), { logger: false });
    app.setGlobalPrefix('api'); app.use(securityHeaders); await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api`;
  });
  after(async () => { await app?.close(); });
  it('exposes no account, image, batch retrieval or OCR recovery routes', async () => {
    assert.match((await fetch(`${base}/demo/config`)).headers.get('cache-control')!, /no-store/);
    for (const path of ['documents', 'results', 'records', 'demo/batches/test', 'demo/extract/test']) assert.equal((await fetch(`${base}/${path}`)).status, 404);
    assert.equal((await fetch(`${base}/demo/recovery`, { method: 'POST' })).status, 404);
  });
  it('requires current browser processing data and refuses unavailable inference', async () => {
    await assert.rejects(new DemoController(null).records({ documents: [] }), (e: any) => e.getStatus() === 400);
    await assert.rejects(new DemoController(null).records({ processingVersion: 2, batchId: 'batch-test', documents: [] }), (e: any) => e.getStatus() === 503);
  });
  it('validates and does not persist an empty complete batch', async () => {
    const response = await fetch(`${base}/demo/records`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ processingVersion: 2, batchId: 'batch-test', documents: [] }) });
    assert.equal(response.status, 201); assert.equal((await response.json() as any).model.state, 'ready');
    assert.equal((await fetch(`${base}/demo/batches/batch-test`)).status, 404);
  });
});

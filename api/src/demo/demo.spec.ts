import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { DemoModule } from './demo.module.js';
import { securityHeaders } from '../security/http-security.js';
import type { JsonModel, ModelTask } from '../records/meta-model.js';
import { PROCESSING_VERSION } from '../shared/processing.js';

/** A stub Meta model: Spark answers each page with one row; Wonder maps nothing. */
function stubModel(delayMs = 0): JsonModel & { calls: ModelTask[] } {
  const calls: ModelTask[] = [];
  return {
    name: 'Synthetic Meta',
    calls,
    async ask<T>(task: ModelTask, signal?: AbortSignal) {
      calls.push(task);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delayMs);
        signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('aborted'));
        });
      });
      if (task.model === 'muse-wonder-1.0') return { tests: [], terms: [] } as T;
      return { rows: [], dates: [], suggestedName: null } as T;
    },
  };
}

async function start(model: JsonModel | null, limits = {}) {
  const app: INestApplication = await NestFactory.create(
    DemoModule.forRoot({ model: null, modelConcurrency: 2 }, model, limits),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  app.use(securityHeaders);
  await app.listen(0, '127.0.0.1');
  return { app, base: `${await app.getUrl()}/api/demo` };
}

let image = '';
const body = (n: number, revision = 'rev-1') => ({
  documentId: 'doc',
  pageId: `doc:${n}`,
  page: n,
  revision,
  image,
});
const post = (url: string, payload: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

describe('batch job API', () => {
  let app: INestApplication, base: string, model: ReturnType<typeof stubModel>;
  before(async () => {
    const png = await sharp({ create: { width: 40, height: 40, channels: 3, background: '#fff' } })
      .png()
      .toBuffer();
    image = `data:image/png;base64,${png.toString('base64')}`;
    model = stubModel(30);
    ({ app, base } = await start(model, { pagesPerBatch: 3 }));
  });
  after(async () => {
    await app?.close();
  });

  it('accepts a page at once and delivers its result through a long poll', async () => {
    const accepted = await post(`${base}/batches/batch-a/pages`, body(0));
    assert.equal(accepted.status, 202);
    assert.equal(((await accepted.json()) as { state: string }).state, 'running');
    let version = 0;
    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/batches/batch-a?since=${version}&wait=5`);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('cache-control')!, /no-store/);
      const view = (await res.json()) as {
        version: number;
        pages: { state: string; result?: unknown }[];
      };
      version = view.version;
      if (view.pages[0].state === 'done') {
        assert.ok(view.pages[0].result);
        break;
      }
    }
    assert.equal(
      (await fetch(`${base}/batches/batch-a/pages/doc:0?revision=rev-1`, { method: 'DELETE' }))
        .status,
      204,
    );
    const after = (await (await fetch(`${base}/batches/batch-a`)).json()) as { pages: unknown[] };
    assert.deepEqual(after.pages, []);
  });

  it('rejects malformed pages and full batches when they are submitted', async () => {
    assert.equal(
      (
        await post(`${base}/batches/batch-b/pages`, {
          ...body(0),
          image: 'data:application/pdf;base64,AA==',
        })
      ).status,
      400,
    );
    assert.equal((await post(`${base}/batches/bad id!/pages`, body(0))).status, 400);
    for (const n of [0, 1, 2])
      assert.equal((await post(`${base}/batches/batch-c/pages`, body(n))).status, 202);
    assert.equal((await post(`${base}/batches/batch-c/pages`, body(3))).status, 429);
    assert.equal((await fetch(`${base}/batches/batch-c`, { method: 'DELETE' })).status, 204);
  });

  it('reads an unknown batch as empty and requires the current processing version', async () => {
    const unknown = await fetch(`${base}/batches/never-seen?since=0&wait=5`);
    assert.deepEqual(await unknown.json(), {
      version: 0,
      pages: [],
      normalization: { state: 'idle' },
    });
    assert.equal((await post(`${base}/batches/batch-d/normalize`, { documents: [] })).status, 400);
    const accepted = await post(`${base}/batches/batch-d/normalize`, {
      processingVersion: PROCESSING_VERSION,
      documents: [],
    });
    assert.equal(accepted.status, 202);
  });

  it('answers a malformed or oversized normalization request with 400, not 500', async () => {
    const observation = (n: number, name: string) => ({
      id: `doc:0:${n}`,
      documentId: 'doc',
      page: 0,
      name,
      valueText: '1',
      unit: null,
      date: null,
    });
    const badDates = await post(`${base}/batches/batch-e/normalize`, {
      processingVersion: PROCESSING_VERSION,
      documents: [{ id: 'doc', name: 'Lab document', observations: [], dates: [{ kind: 'x' }] }],
    });
    assert.equal(badDates.status, 400);
    const tooMany = await post(`${base}/batches/batch-e/normalize`, {
      processingVersion: PROCESSING_VERSION,
      documents: [
        {
          id: 'doc',
          name: 'Lab document',
          observations: Array.from({ length: 401 }, (_, n) => observation(n, `Test ${n}`)),
        },
      ],
    });
    assert.equal(tooMany.status, 400);
    assert.match(((await tooMany.json()) as { message: string }).message, /at most 400/);
  });

  it('has no synchronous or legacy routes', async () => {
    for (const path of ['extract', 'records'])
      assert.equal((await post(`${base}/${path}`, {})).status, 404);
    assert.equal((await fetch(`${base.replace('/demo', '')}/documents`)).status, 404);
  });
});

describe('without a Meta key', () => {
  it('reports processing as unavailable', async () => {
    const { app, base } = await start(null);
    try {
      assert.equal((await post(`${base}/batches/batch-x/pages`, body(0))).status, 503);
      assert.deepEqual(await (await fetch(`${base}/config`)).json(), {
        modelName: null,
        models: null,
      });
    } finally {
      await app.close();
    }
  });
});

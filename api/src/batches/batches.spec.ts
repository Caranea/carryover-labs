import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import { BatchesModule } from './batches.module.js';
import { securityHeaders } from '../security/http-security.js';
import type { JsonModel, ModelTask } from '../records/meta-model.js';
import { PROCESSING_VERSION, type PrintedRow } from '../shared/processing.js';
import { SampleAnswers } from './samples.js';

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

async function start(
  model: JsonModel | null,
  limits = {},
  samples?: SampleAnswers,
  modelDailyBudgetUsd?: number,
) {
  const app: INestApplication = await NestFactory.create(
    BatchesModule.forRoot(
      { model: null, modelConcurrency: 2, modelDailyBudgetUsd },
      model,
      limits,
      samples,
    ),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  app.use(securityHeaders);
  await app.listen(0, '127.0.0.1');
  return { app, base: `${await app.getUrl()}/api` };
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
    assert.equal((await fetch(`${base}/documents`)).status, 404);
  });
});

const row: PrintedRow = {
  name: 'Hemoglobina',
  marker: null,
  section: 'Morfologia',
  value: '13,1',
  unit: 'g/dl',
  reference: '12-16',
  flag: null,
  specimen: null,
  date: { kind: 'collected', printed: '03.02.2025', iso: '2025-02-03' },
  region: [0.1, 0.2, 0.5, 0.05],
  doubt: null,
};
/** A recording of one page and its one test name, as scripts/record-samples.mjs writes it. */
const samples = () =>
  new SampleAnswers({
    recordedAt: '2026-11-01T00:00:00Z',
    models: { transcription: 'muse-spark-1.3', identification: 'muse-wonder-1.0' },
    pages: { 'jane-doe-lab-03:0': { rows: [row], dates: [], suggestedName: 'Morfologia' } },
    identities: {
      'hemoglobina||': { key: 'hgb', newTest: null, panel: 'blood-count', reason: '', words: [] },
    },
    specimens: {},
  });

async function settle(base: string, batch: string) {
  for (let version = 0; ;) {
    const view = (await (
      await fetch(`${base}/batches/${batch}?since=${version}&wait=5`)
    ).json()) as {
      version: number;
      pages: { state: string; error?: string; result?: { observations: unknown[] } }[];
      normalization: {
        state: string;
        error?: string;
        result?: { stats: { values: number } };
      };
    };
    version = view.version;
    const busy = [...view.pages, view.normalization].some(
      (j) => j.state === 'queued' || j.state === 'running',
    );
    if (!busy) return view;
  }
}

describe('without a Meta key', () => {
  it('still reads the sample patient from its recording, and refuses anything else', async () => {
    const { app, base } = await start(null, {}, samples());
    try {
      assert.deepEqual(await (await fetch(`${base}/config`)).json(), {
        models: { transcription: 'muse-spark-1.3', identification: 'muse-wonder-1.0' },
        live: false,
        samplePages: ['jane-doe-lab-03:0'],
      });
      const page = { ...body(0), sample: 'jane-doe-lab-03:0' };
      assert.equal((await post(`${base}/batches/sample-a/pages`, page)).status, 202);
      const pages = await settle(base, 'sample-a');
      assert.equal(pages.pages[0].state, 'done');
      const result = pages.pages[0].result as unknown as {
        documentId: string;
        observations: { name: string; value: number; bbox: number[] }[];
      };
      assert.equal(result.documentId, 'doc');
      assert.equal(result.observations[0].name, 'Hemoglobina');
      assert.equal(result.observations[0].value, 13.1);
      // Regions are placed on the image actually sent (40 × 40 here).
      assert.deepEqual(result.observations[0].bbox, [4, 8, 20, 2]);

      // A sample without a recording is refused, never read live.
      const unknown = await post(`${base}/batches/sample-a/pages`, {
        ...body(1),
        sample: 'jane-doe-lab-03:1',
      });
      assert.equal(unknown.status, 400);
      assert.equal((await post(`${base}/batches/sample-a/pages`, body(1))).status, 503);

      const documents = [
        {
          id: 'doc',
          name: 'Lab document',
          observations: result.observations,
          dates: [],
        },
      ];
      const normalized = await post(`${base}/batches/sample-a/normalize`, {
        processingVersion: PROCESSING_VERSION,
        documents,
      });
      assert.equal(normalized.status, 202);
      const done = await settle(base, 'sample-a');
      assert.equal(done.normalization.state, 'done');
      assert.equal(done.normalization.result?.stats.values, 1);

      // A test name the recording does not know needs Wonder: refused without a key.
      const other = structuredClone(documents);
      (other[0].observations[0] as { name: string }).name = 'Ferritin';
      const refused = await post(`${base}/batches/sample-b/normalize`, {
        processingVersion: PROCESSING_VERSION,
        documents: other,
      });
      assert.equal(refused.status, 503);
      assert.match(((await refused.json()) as { message: string }).message, /sample patient/);
    } finally {
      await app.close();
    }
  });

  it('switches the sample patient off when nothing is recorded', async () => {
    const { app, base } = await start(null);
    try {
      assert.deepEqual(
        ((await (await fetch(`${base}/config`)).json()) as { samplePages: string[] }).samplePages,
        [],
      );
      assert.equal(
        (await post(`${base}/batches/batch-x/pages`, { ...body(0), sample: 'jane-doe-039:0' }))
          .status,
        400,
      );
    } finally {
      await app.close();
    }
  });
});

describe('daily spending limit', () => {
  it('refuses new documents once the limit is reached; the sample patient still works', async () => {
    const model = stubModel();
    // Each Spark call could cost up to $0.14, more than this whole limit.
    const { app, base } = await start(model, {}, samples(), 0.05);
    try {
      assert.equal((await post(`${base}/batches/spend-a/pages`, body(0))).status, 202);
      const view = await settle(base, 'spend-a');
      assert.equal(view.pages[0].state, 'failed');
      assert.match(view.pages[0].error!, /today's limit.*sample patient still works/);
      assert.equal(model.calls.length, 0);
      const sample = { ...body(1), sample: 'jane-doe-lab-03:0' };
      assert.equal((await post(`${base}/batches/spend-a/pages`, sample)).status, 202);
      assert.equal((await settle(base, 'spend-a')).pages[1].state, 'done');
    } finally {
      await app.close();
    }
  });
});

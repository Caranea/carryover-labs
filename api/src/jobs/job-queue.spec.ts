import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PageRequest, PageTranscription } from '../shared/processing.js';
import {
  DEFAULT_LIMITS,
  JobQueue,
  QueueFullError,
  type JobRunner,
  type QueueLimits,
} from './job-queue.js';

/** A runner whose calls stay pending until the test settles them. */
function controlledRunner() {
  const calls: {
    kind: 'page' | 'normalize';
    id: string;
    signal: AbortSignal;
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
  }[] = [];
  const runner: JobRunner<string> = {
    page: (request, signal) =>
      new Promise((resolve, reject) =>
        calls.push({
          kind: 'page',
          id: request.pageId,
          signal,
          resolve: resolve as (v: unknown) => void,
          reject,
        }),
      ),
    normalize: (_documents, signal) =>
      new Promise((resolve, reject) =>
        calls.push({
          kind: 'normalize',
          id: 'batch',
          signal,
          resolve: resolve as (v: unknown) => void,
          reject,
        }),
      ),
  };
  return { runner, calls };
}

const page = (n: number, revision = 'r1', image = 'data:image/png;base64,AAAA'): PageRequest => ({
  batchId: 'b1',
  documentId: 'doc',
  pageId: `doc:${n}`,
  page: n,
  revision,
  image,
});
const transcription = (request: PageRequest) =>
  ({ pageId: request.pageId, rows: [] }) as unknown as PageTranscription;
const settle = () => new Promise((resolve) => setImmediate(resolve));
const queueWith = (runner: JobRunner<string>, limits: Partial<QueueLimits> = {}, now = () => 0) =>
  new JobQueue(runner, { ...DEFAULT_LIMITS, ...limits }, now);

describe('job queue', () => {
  it('runs at most the configured number of model calls and starts the next when one finishes', async () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner, { concurrency: 2 });
    for (const n of [0, 1, 2]) queue.submitPage('b1', page(n));
    assert.equal(calls.length, 2);
    assert.deepEqual(
      queue.view('b1').pages.map((p) => p.state),
      ['running', 'running', 'queued'],
    );
    calls[0].resolve(transcription(page(0)));
    await settle();
    assert.equal(calls.length, 3);
    const view = queue.view('b1');
    assert.equal(view.pages[0].state, 'done');
    assert.equal(view.pages[0].result?.pageId, 'doc:0');
  });

  it('returns the existing job for a repeated page and revision instead of paying twice', () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner);
    queue.submitPage('b1', page(0));
    queue.submitPage('b1', page(0));
    assert.equal(calls.length, 1);
    queue.submitPage('b1', page(0, 'r2'));
    assert.equal(calls.length, 2);
    assert.equal(calls[0].signal.aborted, true, 'the old revision is cancelled');
  });

  it('keeps provider errors out of the result and allows a retry', async () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner);
    queue.submitPage('b1', page(0));
    calls[0].reject(new Error('provider echoed PRIVATE text'));
    await settle();
    const failed = queue.view('b1').pages[0];
    assert.equal(failed.state, 'failed');
    assert.doesNotMatch(failed.error!, /PRIVATE/);
    queue.submitPage('b1', page(0));
    assert.equal(calls.length, 2);
  });

  it('drops a page image from memory once its job has failed or finished', async () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner);
    queue.submitPage('b1', page(0));
    queue.submitPage('b1', page(1));
    calls[0].reject(new Error('busy'));
    calls[1].resolve(transcription(page(1)));
    await settle();
    const held = [
      ...(
        queue as unknown as {
          batches: Map<string, { pages: Map<string, { request: PageRequest }> }>;
        }
      ).batches
        .get('b1')!
        .pages.values(),
    ];
    assert.deepEqual(
      held.map((job) => job.request.image),
      ['', ''],
    );
  });

  it('wakes a waiting poll on change and otherwise answers after the timeout', async () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner);
    queue.submitPage('b1', page(0));
    const version = queue.view('b1').version;
    const waiting = queue.wait('b1', version, 10_000);
    calls[0].resolve(transcription(page(0)));
    const view = await waiting;
    assert.ok(view.version > version);
    assert.equal(view.pages[0].state, 'done');
    const unchanged = await queue.wait('b1', view.version, 5);
    assert.equal(unchanged.version, view.version);
  });

  it('stops the model call when a page is removed, and forgets confirmed pages', async () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner);
    queue.submitPage('b1', page(0));
    queue.removePage('b1', 'doc:0', 'other-revision');
    assert.equal(calls[0].signal.aborted, false, 'a different revision is left alone');
    queue.removePage('b1', 'doc:0', 'r1');
    assert.equal(calls[0].signal.aborted, true);
    assert.deepEqual(queue.view('b1').pages, []);
  });

  it('takes batches in turn so one large upload cannot starve another', () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner, { concurrency: 1 });
    for (const n of [0, 1, 2]) queue.submitPage('big', page(n));
    queue.submitPage('small', { ...page(9), batchId: 'small' });
    calls[0].resolve(transcription(page(0)));
    return settle().then(() => assert.equal(calls[1].id, 'doc:9'));
  });

  it('rejects new pages at submit time when limits are reached', () => {
    const { runner } = controlledRunner();
    const queue = queueWith(runner, { pagesPerBatch: 2, queuedBytes: 100 });
    queue.submitPage('b1', page(0));
    queue.submitPage('b1', page(1));
    assert.throws(() => queue.submitPage('b1', page(2)), QueueFullError);
    assert.throws(
      () => queue.submitPage('b2', page(0, 'r1', `data:image/png;base64,${'A'.repeat(200)}`)),
      QueueFullError,
    );
  });

  it('runs normalization as a job and replaces an older request', async () => {
    const { runner, calls } = controlledRunner();
    const queue = queueWith(runner);
    queue.submitNormalization('b1', []);
    queue.submitNormalization('b1', []);
    assert.equal(calls[0].signal.aborted, true);
    calls[1].resolve('records');
    await settle();
    assert.deepEqual(queue.view('b1').normalization, { state: 'done', result: 'records' });
  });

  it('purges batches nobody has asked about for the time limit', () => {
    const { runner, calls } = controlledRunner();
    let clock = 0;
    const queue = queueWith(runner, { ttlMs: 1000 }, () => clock);
    queue.submitPage('b1', page(0));
    clock = 500;
    queue.sweep();
    assert.equal(queue.view('b1').pages.length, 1);
    clock = 2000;
    queue.sweep();
    assert.deepEqual(queue.view('b1'), { version: 0, pages: [], normalization: { state: 'idle' } });
    assert.equal(calls[0].signal.aborted, true);
  });
});

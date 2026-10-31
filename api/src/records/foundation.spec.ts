import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { KnowledgeStore } from './knowledge.js';
import { MuseSpark, validateAnswer, type ModelTask } from './muse.js';
import { mapNamesTask, reviewTask } from './prompts.js';
import { CATALOGUE } from './catalogue.js';

describe('account-local learned suggestions', () => {
  it('serializes updates from concurrent request-scoped stores without losing mappings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carryover-knowledge-'));
    try {
      await Promise.all(Array.from({ length: 12 }, (_, i) => new KnowledgeStore(dir).update(k => {
        k.names[`name-${i}`] = { key: 'tsh' };
      })));
      assert.equal(Object.keys((await new KnowledgeStore(dir).get()).names).length, 12);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('encrypts content and refuses a wrong key, tampered bytes or account context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carryover-knowledge-'));
    const key = randomBytes(32);
    try {
      const store = new KnowledgeStore(dir, key, 'account-a');
      await store.update(k => { k.names['sensitive-unrecognised-name'] = { key: 'tsh' }; });
      const generation = (await readFile(join(dir, 'current'), 'utf8')).trim();
      const file = join(dir, generation, 'knowledge.json');
      const bytes = await readFile(file);
      assert.equal(bytes.includes(Buffer.from('sensitive-unrecognised-name')), false);
      assert.equal((await store.get()).names['sensitive-unrecognised-name'].key, 'tsh');
      await assert.rejects(new KnowledgeStore(dir, randomBytes(32), 'account-a').get());
      await assert.rejects(new KnowledgeStore(dir, key, 'account-b').get());
      bytes[bytes.length - 1] ^= 1;
      await writeFile(file, bytes);
      await assert.rejects(store.get());
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('a job holding an old generation cannot repopulate deleted account knowledge', async () => {
    const root = await mkdtemp(join(tmpdir(), 'carryover-knowledge-'));
    const dir = join(root, '_knowledge');
    try {
      const oldJob = new KnowledgeStore(dir);
      await oldJob.get();
      await rm(dir, { recursive: true, force: true });
      await assert.rejects(oldJob.get());
      const nextJob = new KnowledgeStore(dir);
      await nextJob.update(k => { k.names['fresh'] = { key: 'plt' }; });
      await assert.rejects(oldJob.get());
      await assert.rejects(oldJob.update(k => { k.names['deleted'] = { key: 'tsh' }; }));
      assert.deepEqual(Object.keys((await nextJob.get()).names), ['fresh']);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('keeps two account directories isolated', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'carryover-knowledge-'));
    try {
      const a = new KnowledgeStore(join(dir, 'a'));
      const b = new KnowledgeStore(join(dir, 'b'));
      await a.update(k => { k.names['private name'] = { key: 'tsh' }; });
      assert.deepEqual((await b.get()).names, {});
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});

describe('model answer boundary', () => {
  const task: ModelTask = { kind: 'test', system: 'Return data', user: 'fictional', schema: {
    type: 'object', additionalProperties: false, required: ['factor'], properties: { factor: { type: 'number' } },
  } };
  const endpoint = { name: 'test', baseUrl: 'https://example.invalid/v1', apiKey: 'test-only', model: 'test-model' };

  it('rejects malformed shape, extra fields and numeric strings', () => {
    assert.deepEqual(validateAnswer(task, { factor: 1 }), { factor: 1 });
    for (const value of [null, [], { factor: '1' }, { factor: 1, advice: 'invented text' }, {}]) {
      assert.throws(() => validateAnswer(task, value));
    }
    assert.deepEqual(validateAnswer(mapNamesTask([], CATALOGUE), { answers: [] }), { answers: [] });
    assert.deepEqual(validateAnswer(reviewTask([]), { flags: [] }), { flags: [] });
  });

  it('also validates the plain-JSON provider fallback', async context => {
    let calls = 0;
    const formats: string[] = [];
    context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      formats.push(JSON.parse(init.body as string).response_format.type);
      if (calls++ === 0) return new Response('{}', { status: 422 });
      return Response.json({ choices: [{ message: { content: '{"factor":"wrong type"}' } }] });
    });
    await assert.rejects(new MuseSpark([endpoint]).ask(task), /automatic check could not finish/);
    assert.deepEqual(formats, ['json_schema', 'json_object']);
  });

  it('rejects oversized replies and keeps echoed patient-like content out of errors', async context => {
    context.mock.method(globalThis, 'fetch', async () => new Response('sensitive-example'.repeat(20_000)));
    await assert.rejects(new MuseSpark([endpoint]).ask(task), error => {
      assert.equal(String(error).includes('sensitive-example'), false);
      return true;
    });
  });

  it('sets the extraction token budget and effort, and rejects truncated output even when JSON is valid', async context => {
    let request: any;
    context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      request = JSON.parse(init.body as string);
      return Response.json({ choices: [{ finish_reason: 'length', message: { content: '{"factor":1}' } }] });
    });
    await assert.rejects(new MuseSpark([endpoint]).ask({ ...task, maxTokens: 8192, reasoningEffort: 'low' }), /automatic check could not finish/);
    assert.equal(request.max_tokens, 8192);
    assert.equal(request.reasoning_effort, 'low');
  });
});

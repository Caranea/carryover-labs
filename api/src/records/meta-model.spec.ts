import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MetaModelClient, parseJson, validateAnswer, type ModelTask } from './meta-model.js';

const task: ModelTask = {
  kind: 'test',
  model: 'muse-spark-1.3',
  system: 'Return data',
  user: 'fictional',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['factor'],
    properties: { factor: { type: 'number' } },
  },
};
const client = () =>
  new MetaModelClient({ baseUrl: 'https://example.invalid/v1', apiKey: 'test-only' }, 1);

describe('model answer boundary', () => {
  it('rejects malformed shape, extra fields and numeric strings', () => {
    assert.deepEqual(validateAnswer(task, { factor: 1 }), { factor: 1 });
    for (const value of [null, [], { factor: '1' }, { factor: 1, advice: 'invented text' }, {}]) {
      assert.throws(() => validateAnswer(task, value));
    }
  });

  it('parses JSON wrapped in a code fence, and never quotes broken JSON in its error', () => {
    assert.deepEqual(parseJson('Sure:\n```json\n{"a":1}\n```'), { a: 1 });
    assert.throws(
      () => parseJson('{"name": "PRIVATE-NAME", oops}'),
      (error: Error) => !error.message.includes('PRIVATE'),
    );
  });

  it('asks again when Meta is busy, and gives up after two more tries', async (context) => {
    const statuses = [429, 503];
    const fetch = context.mock.method(globalThis, 'fetch', async () =>
      statuses.length
        ? new Response('{}', { status: statuses.shift() })
        : Response.json({ choices: [{ message: { content: '{"factor":2}' } }] }),
    );
    assert.deepEqual(await client().ask(task), { factor: 2 });
    assert.equal(fetch.mock.callCount(), 3);
    fetch.mock.mockImplementation(async () => new Response('{}', { status: 503 }));
    fetch.mock.resetCalls();
    await assert.rejects(client().ask(task), /could not finish/);
    assert.equal(fetch.mock.callCount(), 3);
  });

  it('falls back to plain JSON and still validates the answer', async (context) => {
    let calls = 0;
    const formats: string[] = [];
    context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      formats.push(JSON.parse(init.body as string).response_format.type);
      if (calls++ === 0) return new Response('{}', { status: 422 });
      return Response.json({ choices: [{ message: { content: '{"factor":"wrong type"}' } }] });
    });
    await assert.rejects(client().ask(task), /automatic check could not finish/);
    assert.deepEqual(formats, ['json_schema', 'json_object']);
  });

  it('rejects oversized replies and keeps echoed content out of errors', async (context) => {
    context.mock.method(
      globalThis,
      'fetch',
      async () => new Response('sensitive-example'.repeat(20_000)),
    );
    await assert.rejects(client().ask(task), (error) => {
      assert.equal(String(error).includes('sensitive-example'), false);
      return true;
    });
  });

  it('sends the selected model and token budget, and rejects truncated output', async (context) => {
    let request: { model: string; max_tokens: number; reasoning_effort: string } | undefined;
    context.mock.method(globalThis, 'fetch', async (_url: unknown, init: RequestInit) => {
      request = JSON.parse(init.body as string);
      return Response.json({
        choices: [{ finish_reason: 'length', message: { content: '{"factor":1}' } }],
      });
    });
    await assert.rejects(
      client().ask({ ...task, model: 'muse-wonder-1.0', maxTokens: 8192, reasoningEffort: 'low' }),
      /could not finish/,
    );
    assert.equal(request?.model, 'muse-wonder-1.0');
    assert.equal(request?.max_tokens, 8192);
    assert.equal(request?.reasoning_effort, 'low');
  });
});

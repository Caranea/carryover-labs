import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JsonModel, ModelTask } from '../records/meta-model.js';
import { BudgetSpent, cost, DailySpend, PublicError } from './daily-spend.js';

const spark: ModelTask = {
  kind: 'transcribe-page',
  model: 'muse-spark-1.3',
  system: '',
  user: '',
  schema: {},
  maxTokens: 1000,
};

describe('daily spending limit', () => {
  it('prices tokens per model, reasoning billed as output', () => {
    assert.equal(cost('muse-spark-1.3', { input: 1_000_000, output: 1_000_000 }), 5.5);
    assert.equal(cost('muse-wonder-1.0', { input: 1_000_000, output: 0 }), 4);
  });

  it('charges reported usage, refuses calls past the cap and starts again the next UTC day', async () => {
    let now = Date.parse('2026-11-03T23:59:00Z');
    const spend = new DailySpend(0.01, () => now);
    let calls = 0;
    const model: JsonModel = {
      name: 'stub',
      ask: async <T>(task: ModelTask) => {
        calls++;
        // 2,000 output tokens of Spark: $0.0085 per call.
        spend.charge(task, { input: 0, output: 2000 });
        return {} as T;
      },
    };
    const guarded = spend.guard(model);
    await guarded.ask(spark);
    assert.equal(spend.spent(), false);
    // The next call could cost up to $0.00425 more: that would pass $0.01, so it is refused.
    const refused = await guarded.ask(spark).catch((error: unknown) => error);
    assert.ok(refused instanceof BudgetSpent && refused instanceof PublicError);
    assert.match((refused as Error).message, /sample patient still works/);
    assert.equal(calls, 1);
    spend.charge(spark, { input: 0, output: 1000 });
    assert.equal(spend.spent(), true);
    now = Date.parse('2026-11-04T00:01:00Z');
    assert.equal(spend.spent(), false);
    await guarded.ask(spark);
    assert.equal(calls, 2);
  });

  it('holds back the worst case of calls still running', async () => {
    const spend = new DailySpend(0.006);
    let release!: () => void;
    const model: JsonModel = {
      name: 'stub',
      ask: <T>() => new Promise<T>((resolve) => (release = () => resolve({} as T))),
    };
    const guarded = spend.guard(model);
    const first = guarded.ask(spark);
    // $0.00425 is held for the running call; a second one would pass $0.006.
    await assert.rejects(guarded.ask(spark), BudgetSpent);
    release();
    await first;
    // Nothing reported: the hold is released, and a call fits again.
    const second = guarded.ask(spark);
    release();
    await second;
  });

  it('charges the worst case when usage is not reported', () => {
    const spend = new DailySpend(1);
    spend.charge(spark);
    assert.equal(spend.spentToday, cost('muse-spark-1.3', { input: 0, output: 1000 }));
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { JsonModel } from '../records/meta-model.js';
import { BudgetSpent, DailyBudget } from './daily-budget.js';

describe('daily model budget', () => {
  it('refuses calls once the day is used up and starts again the next UTC day', async () => {
    let calls = 0;
    const model: JsonModel = {
      name: 'stub',
      ask: async <T>() => {
        calls++;
        return {} as T;
      },
    };
    let now = Date.parse('2026-11-03T23:59:00Z');
    const budget = new DailyBudget(model, 2, () => now);
    const task = { kind: 'k', model: 'muse-spark-1.3', system: '', user: '', schema: {} } as const;
    await budget.ask(task);
    await budget.ask(task);
    assert.equal(budget.spent(), true);
    await assert.rejects(budget.ask(task), BudgetSpent);
    assert.equal(calls, 2);
    now = Date.parse('2026-11-04T00:01:00Z');
    assert.equal(budget.spent(), false);
    await budget.ask(task);
    assert.equal(calls, 3);
  });
});

import type { JsonModel, MetaModel, ModelTask } from '../records/meta-model.js';

/** A message written for the visitor: the job error shows it as is. */
export class PublicError extends Error {}

/** Thrown instead of calling the model once today's spending limit is reached. */
export class BudgetSpent extends PublicError {
  constructor() {
    super(
      "Reading new documents has reached today's limit. Your documents are saved: try again " +
        'tomorrow. The sample patient still works.',
    );
  }
}

/** US dollars per million tokens. Reasoning tokens are billed as output. */
export const PRICES: Record<MetaModel, { input: number; output: number }> = {
  'muse-spark-1.3': { input: 1.25, output: 4.25 },
  'muse-wonder-1.0': { input: 4, output: 20 },
};

/** Tokens as reported by the API: `prompt_tokens`, `completion_tokens`. */
export interface TokenUsage {
  input: number;
  output: number;
}

/** A rough upper bound before the call: about 4 characters a token, a page image ~3,000. */
export function estimate(task: ModelTask): TokenUsage {
  return {
    input: Math.ceil((task.system.length + task.user.length) / 4) + (task.image ? 3000 : 0),
    output: task.maxTokens ?? 4096,
  };
}

export function cost(model: MetaModel, usage: TokenUsage): number {
  const price = PRICES[model];
  return (usage.input * price.input + usage.output * price.output) / 1_000_000;
}

/**
 * A cap in US dollars on model spending per UTC day, across all visitors. Every answer is
 * charged from the token usage Meta reports, cut-off answers included; while calls run, their
 * worst case is held back, so parallel calls cannot overshoot the cap by much.
 */
export class DailySpend {
  private day = '';
  private charged = 0;
  private held = 0;

  constructor(
    readonly dollarsPerDay: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Today's charges so far, in US dollars. */
  get spentToday(): number {
    this.rollOver();
    return this.charged;
  }

  /** Nothing left today: new work is refused up front rather than failing midway. */
  spent(): boolean {
    return this.spentToday >= this.dollarsPerDay;
  }

  /** Record one answer's cost. Without a usage report, the worst case is charged. */
  charge(task: ModelTask, usage?: TokenUsage): void {
    this.rollOver();
    this.charged += cost(task.model, usage ?? estimate(task));
  }

  /** The model, refusing calls that could take today's spending past the cap. */
  guard(model: JsonModel): JsonModel {
    return {
      name: model.name,
      ask: async <T>(task: ModelTask, signal?: AbortSignal): Promise<T> => {
        const worst = cost(task.model, estimate(task));
        if (this.spentToday + this.held + worst > this.dollarsPerDay) throw new BudgetSpent();
        this.held += worst;
        try {
          return await model.ask<T>(task, signal);
        } finally {
          this.held -= worst;
        }
      },
    };
  }

  private rollOver() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.charged = 0;
    }
  }
}

import type { JsonModel, ModelTask } from '../records/meta-model.js';

/** Thrown instead of calling the model once today's calls are used up. */
export class BudgetSpent extends Error {}

/**
 * A cap on paid model calls per UTC day, across all visitors. It counts every call, including
 * the extra ones a cut-off answer causes, so one heavy batch can't spend more than the cap.
 */
export class DailyBudget implements JsonModel {
  private day = '';
  private used = 0;

  constructor(
    private readonly model: JsonModel,
    readonly callsPerDay: number,
    private readonly now: () => number = Date.now,
  ) {}

  get name(): string {
    return this.model.name;
  }

  /** No calls left today. Submissions are refused up front rather than failing midway. */
  spent(): boolean {
    this.rollOver();
    return this.used >= this.callsPerDay;
  }

  ask<T>(task: ModelTask, signal?: AbortSignal): Promise<T> {
    if (this.spent()) return Promise.reject(new BudgetSpent('Daily model budget used up'));
    this.used++;
    return this.model.ask<T>(task, signal);
  }

  private rollOver() {
    const day = new Date(this.now()).toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
  }
}

import {
  DynamicModule,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { AppConfig } from '../config.js';
import { DEFAULT_LIMITS, JobQueue, type QueueLimits } from '../jobs/job-queue.js';
import { DailyBudget } from '../jobs/daily-budget.js';
import { MetaModelClient, type JsonModel } from '../records/meta-model.js';
import { DEMO_BUDGET, DEMO_QUEUE, DemoController, HealthController } from './demo.controller.js';
import { normalizeBatch, type RecordsResult } from './normalization.js';
import { processPage } from './source-processing.js';

/** How often expired batches are purged. */
const SWEEP_MS = 60_000;

@Module({})
export class DemoModule implements OnModuleInit, OnModuleDestroy {
  private sweeper?: NodeJS.Timeout;

  constructor(@Inject(DEMO_QUEUE) private readonly queue: JobQueue<RecordsResult> | null) {}

  /** Pass `model` to replace the Meta client in tests; `null` disables inference. */
  static forRoot(
    config: Pick<AppConfig, 'model' | 'modelConcurrency'> &
      Partial<Pick<AppConfig, 'modelDailyCalls'>>,
    model?: JsonModel | null,
    limits: Partial<QueueLimits> = {},
  ): DynamicModule {
    const meta =
      model !== undefined ? model : config.model ? new MetaModelClient(config.model) : null;
    const client = meta ? new DailyBudget(meta, config.modelDailyCalls ?? 1000) : null;
    const queue = client
      ? new JobQueue<RecordsResult>(
          {
            page: (request, signal) => processPage(request, client, signal),
            normalize: (documents, signal) => normalizeBatch(documents, client, signal),
          },
          { ...DEFAULT_LIMITS, concurrency: config.modelConcurrency, ...limits },
        )
      : null;
    return {
      module: DemoModule,
      controllers: [DemoController, HealthController],
      providers: [
        { provide: DEMO_QUEUE, useValue: queue },
        { provide: DEMO_BUDGET, useValue: client },
      ],
    };
  }

  onModuleInit() {
    this.sweeper = setInterval(() => this.queue?.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }
}

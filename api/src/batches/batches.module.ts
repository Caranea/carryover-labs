import {
  DynamicModule,
  Inject,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { AppConfig } from '../config.js';
import { DEFAULT_LIMITS, JobQueue, type QueueLimits } from '../jobs/job-queue.js';
import { DailySpend, PublicError } from '../jobs/daily-spend.js';
import { MetaModelClient, type JsonModel } from '../records/meta-model.js';
import {
  BatchesController,
  HealthController,
  JOB_QUEUE,
  READING,
  type Reading,
} from './batches.controller.js';
import { normalizeBatch, type RecordsResult } from './normalization.js';
import { SampleAnswers } from './samples.js';
import { processPage } from './source-processing.js';

const LIVE_OFF =
  'Reading new documents is switched off on this server: only the sample patient works here.';

/** How often expired batches are purged. */
const SWEEP_MS = 60_000;

@Module({})
export class BatchesModule implements OnModuleInit, OnModuleDestroy {
  private sweeper?: NodeJS.Timeout;

  constructor(@Inject(JOB_QUEUE) private readonly queue: JobQueue<RecordsResult>) {}

  /**
   * Pass `model` to replace the Meta client in tests (`null`: no key), and `samples` to replace
   * the committed recording. Without a key the queue still runs: it answers the sample patient.
   */
  static forRoot(
    config: Pick<AppConfig, 'model' | 'modelConcurrency'> &
      Partial<Pick<AppConfig, 'modelDailyBudgetUsd' | 'samplesFile'>>,
    model?: JsonModel | null,
    limits: Partial<QueueLimits> = {},
    samples?: SampleAnswers,
  ): DynamicModule {
    const spend = new DailySpend(config.modelDailyBudgetUsd ?? 10);
    const meta =
      model !== undefined
        ? model
        : config.model
          ? new MetaModelClient(config.model, undefined, (task, usage) => spend.charge(task, usage))
          : null;
    const live = meta ? spend.guard(meta) : null;
    const recorded =
      samples ??
      (config.samplesFile ? SampleAnswers.load(config.samplesFile) : new SampleAnswers(null));
    const queue = new JobQueue<RecordsResult>(
      {
        page: async (request, signal) => {
          if (request.sample) return processPage(request, recorded.page(request.sample), signal);
          if (!live) throw new PublicError(LIVE_OFF);
          return processPage(request, live, signal);
        },
        normalize: (documents, signal) =>
          normalizeBatch(documents, live, signal, { cache: recorded }),
      },
      { ...DEFAULT_LIMITS, concurrency: config.modelConcurrency, ...limits },
    );
    const reading: Reading = { live: !!live, spend, samples: recorded };
    return {
      module: BatchesModule,
      controllers: [BatchesController, HealthController],
      providers: [
        { provide: JOB_QUEUE, useValue: queue },
        { provide: READING, useValue: reading },
      ],
    };
  }

  onModuleInit() {
    this.sweeper = setInterval(() => this.queue.sweep(), SWEEP_MS);
    this.sweeper.unref();
  }

  onModuleDestroy() {
    clearInterval(this.sweeper);
  }
}

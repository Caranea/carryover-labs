import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { QueueFullError, type JobQueue } from '../jobs/job-queue.js';
import type { DailyBudget } from '../jobs/daily-budget.js';
import { MAX_WAIT_SECONDS } from '../shared/jobs.js';
import type { RecordsResult } from './normalization.js';
import { InvalidRequest, parseRecordsRequest } from './records-request.js';
import { ID, parsePageRequest, SPARK_MODEL } from './source-processing.js';
import { WONDER_MODEL } from './normalization.js';

export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const MODEL_BUDGET = Symbol('MODEL_BUDGET');

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, storage: 'browser' };
  }
}

/**
 * Page transcription and normalization as jobs. Requests return at once; the browser
 * collects results with one long poll per batch. Nothing is written to disk.
 */
@Controller()
export class BatchesController {
  constructor(
    @Inject(JOB_QUEUE) private readonly queue: JobQueue<RecordsResult> | null,
    @Inject(MODEL_BUDGET) private readonly budget: DailyBudget | null,
  ) {}

  /** Whether live reading is switched on, and with which Meta models. */
  @Get('config')
  config() {
    return {
      modelName: this.queue ? 'Meta Model API' : null,
      models: this.queue ? { transcription: SPARK_MODEL, identification: WONDER_MODEL } : null,
    };
  }

  /** Queue one approved, redacted page for Muse Spark. */
  @Post('batches/:batchId/pages')
  @HttpCode(202)
  submitPage(@Param('batchId') batchId: string, @Body() body: unknown) {
    const queue = this.requireBudget();
    const id = validBatch(batchId);
    let request;
    try {
      request = parsePageRequest({ ...(body as object), batchId: id });
    } catch {
      throw new BadRequestException(
        'This page could not be sent. Reopen the document and try again.',
      );
    }
    return limited(() => queue.submitPage(id, request));
  }

  /** Queue Muse Wonder normalization of the complete batch. */
  @Post('batches/:batchId/normalize')
  @HttpCode(202)
  submitNormalization(@Param('batchId') batchId: string, @Body() body: unknown) {
    const queue = this.requireBudget();
    let documents;
    try {
      documents = parseRecordsRequest(body);
    } catch (error) {
      if (error instanceof InvalidRequest) throw new BadRequestException(error.message);
      throw error;
    }
    return limited(() => queue.submitNormalization(validBatch(batchId), documents));
  }

  /** The batch's jobs. With `wait`, answers on the next change or after at most 25 s. */
  @Get('batches/:batchId')
  async batch(
    @Param('batchId') batchId: string,
    @Query('since') since: string | undefined,
    @Query('wait') wait: string | undefined,
    @Req() req: Request,
  ) {
    const queue = this.requireQueue();
    const seconds = Math.min(Math.max(Number(wait) || 0, 0), MAX_WAIT_SECONDS);
    const closed = new AbortController();
    req.once('close', () => closed.abort());
    return queue.wait(validBatch(batchId), Number(since) || 0, seconds * 1000, closed.signal);
  }

  /** Confirm a saved page, or cancel it. */
  @Delete('batches/:batchId/pages/:pageId')
  @HttpCode(204)
  removePage(
    @Param('batchId') batchId: string,
    @Param('pageId') pageId: string,
    @Query('revision') revision: string | undefined,
  ) {
    this.requireQueue().removePage(validBatch(batchId), pageId, revision);
  }

  /** Cancel and forget the whole batch. */
  @Delete('batches/:batchId')
  @HttpCode(204)
  removeBatch(@Param('batchId') batchId: string) {
    this.requireQueue().removeBatch(validBatch(batchId));
  }

  private requireQueue(): JobQueue<RecordsResult> {
    if (!this.queue) throw new HttpException('Live reading is switched off on this server.', 503);
    return this.queue;
  }

  /** New paid work is refused up front once today's model calls are used up. */
  private requireBudget(): JobQueue<RecordsResult> {
    const queue = this.requireQueue();
    if (this.budget?.spent())
      throw new HttpException(
        "Live reading has reached today's limit. Your documents are saved; try again tomorrow.",
        503,
      );
    return queue;
  }
}

function validBatch(batchId: string): string {
  if (!ID.test(batchId)) throw new BadRequestException('Invalid batch');
  return batchId;
}

function limited<T>(submit: () => T): T {
  try {
    return submit();
  } catch (error) {
    if (error instanceof QueueFullError) throw new HttpException(error.message, 429);
    throw error;
  }
}

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
import type { DailySpend } from '../jobs/daily-spend.js';
import { MAX_WAIT_SECONDS } from '../shared/jobs.js';
import { unanswered, WONDER_MODEL, type RecordsResult } from './normalization.js';
import { InvalidRequest, parseRecordsRequest } from './records-request.js';
import type { SampleAnswers } from './samples.js';
import { ID, parsePageRequest, SPARK_MODEL } from './source-processing.js';

export const JOB_QUEUE = Symbol('JOB_QUEUE');
export const READING = Symbol('READING');

/** What can be read: new documents (live, paid, capped per day) and the recorded sample patient. */
export interface Reading {
  live: boolean;
  spend: DailySpend;
  samples: SampleAnswers;
}

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
    @Inject(JOB_QUEUE) private readonly queue: JobQueue<RecordsResult>,
    @Inject(READING) private readonly reading: Reading,
  ) {}

  /**
   * The Meta models, whether new documents can be read (`live`: a key is set), and which sample
   * patient pages have recorded answers.
   */
  @Get('config')
  config() {
    return {
      models: { transcription: SPARK_MODEL, identification: WONDER_MODEL },
      live: this.reading.live,
      samplePages: this.reading.samples.pages,
    };
  }

  /** Queue one approved, redacted page for Muse Spark, or answer a sample page from its recording. */
  @Post('batches/:batchId/pages')
  @HttpCode(202)
  submitPage(@Param('batchId') batchId: string, @Body() body: unknown) {
    const id = validBatch(batchId);
    let request;
    try {
      request = parsePageRequest({ ...(body as object), batchId: id });
    } catch {
      throw new BadRequestException(
        'This page could not be sent. Reopen the document and try again.',
      );
    }
    // A sample page is never sent to Meta: without a recording it is refused, not read live.
    if (request.sample) {
      if (!this.reading.samples.has(request.sample))
        throw new BadRequestException('This sample page has no recorded answer.');
    } else this.requireLive();
    return limited(() => this.queue.submitPage(id, request));
  }

  /** Queue Muse Wonder normalization of the complete batch. */
  @Post('batches/:batchId/normalize')
  @HttpCode(202)
  submitNormalization(@Param('batchId') batchId: string, @Body() body: unknown) {
    const id = validBatch(batchId);
    let documents;
    try {
      documents = parseRecordsRequest(body);
    } catch (error) {
      if (error instanceof InvalidRequest) throw new BadRequestException(error.message);
      throw error;
    }
    // Test names the sample recording covers need no live call, so no key and no budget.
    if (unanswered(documents, this.reading.samples) > 0) this.requireLive();
    return limited(() => this.queue.submitNormalization(id, documents));
  }

  /** The batch's jobs. With `wait`, answers on the next change or after at most 20 s. */
  @Get('batches/:batchId')
  async batch(
    @Param('batchId') batchId: string,
    @Query('since') since: string | undefined,
    @Query('wait') wait: string | undefined,
    @Req() req: Request,
  ) {
    const seconds = Math.min(Math.max(Number(wait) || 0, 0), MAX_WAIT_SECONDS);
    const closed = new AbortController();
    req.once('close', () => closed.abort());
    return this.queue.wait(validBatch(batchId), Number(since) || 0, seconds * 1000, closed.signal);
  }

  /** Confirm a saved page, or cancel it. */
  @Delete('batches/:batchId/pages/:pageId')
  @HttpCode(204)
  removePage(
    @Param('batchId') batchId: string,
    @Param('pageId') pageId: string,
    @Query('revision') revision: string | undefined,
  ) {
    this.queue.removePage(validBatch(batchId), pageId, revision);
  }

  /** Cancel and forget the whole batch. */
  @Delete('batches/:batchId')
  @HttpCode(204)
  removeBatch(@Param('batchId') batchId: string) {
    this.queue.removeBatch(validBatch(batchId));
  }

  /** New paid work: refused up front without a key, or once today's spending limit is reached. */
  private requireLive(): void {
    if (!this.reading.live)
      throw new HttpException(
        'Reading new documents is switched off on this server. Try the sample patient.',
        503,
      );
    if (this.reading.spend.spent())
      throw new HttpException(
        "Reading new documents has reached today's limit. Your documents are saved: try again " +
          'tomorrow. The sample patient still works.',
        503,
      );
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

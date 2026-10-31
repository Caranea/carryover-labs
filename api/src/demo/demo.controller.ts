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
import { MAX_WAIT_SECONDS } from '../shared/jobs.js';
import type { RecordsResult } from './normalization.js';
import { InvalidRequest, parseRecordsRequest } from './records-request.js';
import { ID, parsePageRequest } from './source-processing.js';

export const DEMO_QUEUE = Symbol('DEMO_QUEUE');

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
@Controller('demo')
export class DemoController {
  constructor(@Inject(DEMO_QUEUE) private readonly queue: JobQueue<RecordsResult> | null) {}

  @Get('config')
  config() {
    return { modelName: this.queue ? 'Meta Model API' : null };
  }

  /** Queue one approved, redacted page for Muse Spark. */
  @Post('batches/:batchId/pages')
  @HttpCode(202)
  submitPage(@Param('batchId') batchId: string, @Body() body: unknown) {
    const queue = this.requireQueue();
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
    const queue = this.requireQueue();
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
    if (!this.queue)
      throw new HttpException('Results processing is unavailable. Please try again.', 503);
    return this.queue;
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

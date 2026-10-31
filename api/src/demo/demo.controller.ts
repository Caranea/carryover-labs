import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Logger,
  Post,
} from '@nestjs/common';
import type { JsonModel } from '../records/meta-model.js';
import { normalizeBatch } from './normalization.js';
import { InvalidRequest, parseRecordsRequest } from './records-request.js';
import { processPage } from './source-processing.js';

export const DEMO_MODEL = Symbol('DEMO_MODEL');

/** At most this many model requests run at once in this process. */
const MAX_ACTIVE = 4;

@Controller()
export class HealthController {
  @Get('health')
  health() {
    return { ok: true, storage: 'browser' };
  }
}

/** Request-scoped inference only: nothing is stored on the server. */
@Controller('demo')
export class DemoController {
  private active = 0;
  private readonly log = new Logger('Demo');

  constructor(@Inject(DEMO_MODEL) private readonly model: JsonModel | null) {}

  @Get('config')
  config() {
    return { modelName: this.model?.name ?? null };
  }

  /** Muse Spark transcribes one approved, redacted page image. */
  @Post('extract')
  async extract(@Body() body: unknown) {
    const model = this.requireModel();
    return this.bounded(
      'transcription',
      'This page could not finish transcription. Please try again.',
      async () => {
        const result = await processPage(body, model);
        return { result, detail: `page=${result.pageId}, rows=${result.observations.length}` };
      },
    );
  }

  /** Muse Wonder normalizes test identities for a complete batch; the server builds the charts. */
  @Post('records')
  async records(@Body() body: unknown) {
    let request;
    try {
      request = parseRecordsRequest(body);
    } catch (error) {
      if (error instanceof InvalidRequest) throw new BadRequestException(error.message);
      throw error;
    }
    const model = this.requireModel();
    return this.bounded(
      'normalization',
      'Results normalization did not finish. Please try again.',
      async () => {
        const result = await normalizeBatch(request.documents, model);
        const rows = request.documents.reduce((n, d) => n + d.observations.length, 0);
        return {
          result,
          detail: `batch=${request.batchId}, documents=${request.documents.length}, rows=${rows}`,
        };
      },
    );
  }

  private requireModel(): JsonModel {
    if (!this.model)
      throw new HttpException('Results processing is unavailable. Please try again.', 503);
    return this.model;
  }

  private async bounded<T>(
    stage: string,
    failure: string,
    work: () => Promise<{ result: T; detail: string }>,
  ): Promise<T> {
    if (this.active >= MAX_ACTIVE)
      throw new HttpException('AI checks are busy. Try again shortly.', 429);
    this.active++;
    const started = Date.now();
    try {
      const { result, detail } = await work();
      this.log.log(`${stage}: ${detail}, elapsedMs=${Date.now() - started}`);
      return result;
    } catch {
      // Never log request or provider content.
      this.log.warn(`${stage} failed: elapsedMs=${Date.now() - started}`);
      throw new HttpException(failure, 502);
    } finally {
      this.active--;
    }
  }
}

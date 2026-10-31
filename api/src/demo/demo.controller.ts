import { BadRequestException, Body, Controller, Get, HttpException, Inject, Logger, Post } from '@nestjs/common';
import type { JsonModel } from '../records/muse.js';
import { validateAnswer } from '../records/muse.js';
import type { BuildDocument } from '../records/build.js';
import type { Observation } from '../results/contract.js';
import { parseNumber, toIsoDate } from '../results/tokens.js';
import { processPage, transcriptionSchema } from './source-processing.js';
import { normalizeBatch } from './normalization.js';
import { PROCESSING_VERSION } from './processing-contract.js';

export const DEMO_MODEL = Symbol('DEMO_MODEL');
@Controller()
export class DemoHealthController {
  @Get('health')
  health() { return { ok: true, storage: 'browser' }; }
}

/** Request-scoped inference only. There is no batch retrieval or stored server job. */
@Controller('demo')
export class DemoController {
  private active = 0;
  private readonly log = new Logger('DemoRecords');
  constructor(@Inject(DEMO_MODEL) private readonly model: JsonModel | null) {}

  @Get('config')
  config() { return { modelName: this.model?.name ?? null }; }

  @Post('extract')
  async extract(@Body() body: any) {
    if (!this.model) throw new HttpException('Results processing is unavailable. Please try again.', 503);
    return this.bounded(async () => {
      const started = Date.now();
      try {
        const result = await processPage(body, this.model!);
        this.log.log(`transcription: batch=${result.batchId}, page=${result.pageId}, rows=${result.observations.length}, elapsedMs=${Date.now() - started}`);
        return result;
      } catch {
        this.log.warn(`Page transcription failed: elapsedMs=${Date.now() - started}`);
        throw new HttpException('This page could not finish transcription. Please try again.', 502);
      }
    });
  }

  @Post('records')
  async records(@Body() body: any) {
    if (body?.processingVersion !== PROCESSING_VERSION) throw new BadRequestException('Reprocess the approved pages with the current version.');
    const batchId = body.batchId;
    if (typeof batchId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(batchId)) throw new BadRequestException('Invalid batch');
    const docs = parseRecords(body);
    if (!this.model) throw new HttpException('Results processing is unavailable. Please try again.', 503);
    return this.bounded(async () => {
      const started = Date.now();
      try {
        const result = await normalizeBatch(docs, this.model!);
        this.log.log(`normalization: batch=${batchId}, documents=${docs.length}, rows=${docs.reduce((n, d) => n + d.observations.length, 0)}, elapsedMs=${Date.now() - started}`);
        return result;
      } catch {
        this.log.warn(`Normalization failed: batch=${batchId}, elapsedMs=${Date.now() - started}`);
        throw new HttpException('Results normalization did not finish. Please try again.', 502);
      }
    });
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new HttpException('AI checks are busy. Try again shortly.', 429);
    this.active++;
    try { return await work(); } finally { this.active--; }
  }
}

function parseRecords(body: any): BuildDocument[] {
  if (!Array.isArray(body?.documents) || body.documents.length > 100) throw new BadRequestException('Send at most 100 documents per check.');
  let count = 0;
  const ids = new Set<string>(), docIds = new Set<string>();
  try {
    return body.documents.map((doc: any) => {
      if (typeof doc?.id !== 'string' || doc.id.length > 100 || typeof doc.name !== 'string' || doc.name.length > 120 || !Array.isArray(doc.observations)) throw new Error();
      if (docIds.has(doc.id)) throw new Error();
      docIds.add(doc.id);
      const observations: Observation[] = doc.observations.map((o: any) => {
        if (++count > 5000 || typeof o?.id !== 'string' || o.id.length > 200 || o.documentId !== doc.id
          || !Number.isInteger(o.page) || o.page < 0 || o.page >= 40
          || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 200
          || typeof o.valueText !== 'string' || o.valueText.length > 100
          || !(o.unit === null || (typeof o.unit === 'string' && o.unit.length <= 60))
          || !(o.date === null || (typeof o.date === 'string' && toIsoDate(o.date, 'YMD') === o.date))) throw new Error();
        if (ids.has(o.id)) throw new Error();
        ids.add(o.id);
        const parsed = parseNumber(o.valueText);
        return { id: o.id, documentId: doc.id, page: o.page, words: [], name: o.name, valueText: o.valueText,
          ...(o.transcription ? { transcription: validateAnswer<any>({ kind: 'validate-source', system: '', user: '', schema: transcriptionSchema.properties.rows.items }, o.transcription) } : {}),
          ...(o.sourceImage && typeof o.sourceImage.pageId === 'string' && o.sourceImage.pageId === `${doc.id}:${o.page}` ? { sourceImage: o.sourceImage } : {}),
          value: parsed?.value ?? null, comparator: parsed?.comparator ?? null, unit: o.unit, date: o.date,
          dateSource: o.date ? (o.dateSource === 'label' ? 'label' : 'user') : null, refLow: null, refHigh: null, flag: ['H', 'L', 'HH', 'LL', 'A'].includes(o.flag) ? o.flag : null,
          refText: typeof o.refText === 'string' ? o.refText.slice(0, 200) : null,
          bbox: Array.isArray(o.bbox) && o.bbox.length === 4 && o.bbox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) ? o.bbox : null,
          confirmed: o.confirmed === true, revision: typeof o.revision === 'string' ? o.revision.slice(0, 100) : undefined };
      });
      return { id: doc.id, name: doc.name, observations, review: null };
    });
  } catch { throw new BadRequestException('The result snapshot is invalid. Reload your saved results.'); }
}

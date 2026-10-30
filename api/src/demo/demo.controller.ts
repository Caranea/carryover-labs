import { BadRequestException, Body, Controller, Get, HttpException, Inject, Logger, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { SavedDocument } from '../documents/contract.js';
import { parseManifest } from '../documents/validate.js';
import { buildRecords, type BuildDocument } from '../records/build.js';
import { CATALOGUE } from '../records/catalogue.js';
import { decideName, type NameAnswer } from '../records/decisions.js';
import type { Knowledge } from '../records/knowledge-types.js';
import { mapNamesTask, reviewTask } from '../records/prompts.js';
import { validateAnswer, type JsonModel } from '../records/muse.js';
import type { Observation } from '../results/contract.js';
import { parseNumber, toIsoDate } from '../results/tokens.js';
import { extractDocument } from '../results/extract.js';
import { RECOVERY_LIMITS, recoveryTask, type RecoveryAnswer } from '../recovery/prompt.js';
import { presentProposal, recoveryProposalId, recoverySourceRevision, verifyEvidence } from '../recovery/verify.js';

export const DEMO_MODEL = Symbol('DEMO_MODEL');

@Controller()
export class DemoHealthController {
  @Get('health')
  health() { return { ok: true, storage: 'browser' }; }
}

/** Stateless inference: all input belongs to this request; no document-store routes or user IDs. */
@Controller('demo')
export class DemoController {
  private active = 0;
  private readonly log = new Logger('DemoRecords');
  constructor(@Inject(DEMO_MODEL) private readonly model: JsonModel | null) {}

  @Get('config')
  config() { return { modelName: this.model?.name ?? null }; }

  @Post('records')
  async records(@Body() body: unknown) {
    const docs = parseRecords(body);
    if (!this.model) throw new HttpException('Results processing is unavailable. Please try again.', 503);
    const knowledge: Knowledge = { version: 1, names: {}, tests: [], conversions: {} };
    const build = () => buildRecords(docs, knowledge, true);
    return this.bounded(async () => {
      const started = Date.now();
      let stage = 'name matching', mappingCalls = 0, reviewed = 0;
      try {
        let { pending } = build();
        // Every successful batch must resolve names. The input limits bound
        // the work; an arbitrary call cap otherwise rejects healthy batches.
        while (pending.names.length) {
          const seen = new Set<string>();
          const names = pending.names.filter((row) => {
            if (seen.has(row.printedName) || seen.size >= 40) return false;
            seen.add(row.printedName); return true;
          });
          const task = mapNamesTask(names, [...CATALOGUE, ...knowledge.tests]);
          mappingCalls++;
          const answer = validateAnswer<{ answers: NameAnswer[] }>(task, await this.model!.ask(task));
          const mapped = new Map(answer.answers.map((row) => [row.name, row]));
          if (mapped.size !== names.length) throw new Error('Mismatched names');
          for (const row of names) {
            const answer = mapped.get(row.printedName);
            const decision = answer && decideName(answer, [...CATALOGUE, ...knowledge.tests]);
            if (!decision) throw new Error('Invalid mapping');
            if (decision.newTest) knowledge.tests.push(decision.newTest);
            knowledge.names[row.name] = { key: decision.key, reason: decision.reason };
          }
          const next = build().pending;
          if (next.names.length >= pending.names.length) throw new Error('Name matching made no progress');
          pending = next;
        }
        stage = 'document review';
        // Reviews are independent once names are resolved. Keep concurrency
        // small while allowing a large batch to finish without serial waits.
        for (let offset = 0; offset < pending.reviews.length; offset += 3) {
          const outcomes = await Promise.allSettled(pending.reviews.slice(offset, offset + 3).map(async review => {
            const task = reviewTask(review.rows);
            const answer = validateAnswer<{ flags: { row: number; reason: string }[] }>(task, await this.model!.ask(task));
            docs.find((doc) => doc.id === review.documentId)!.review = { hash: review.hash, flags: answer.flags
              .filter((flag) => Number.isInteger(flag.row) && flag.row >= 1 && flag.row <= review.rows.length)
              .map((flag) => ({ id: review.rows[flag.row - 1].id, reason: flag.reason.slice(0, 300) })) };
            reviewed++;
          }));
          const failed = outcomes.find(outcome => outcome.status === 'rejected');
          if (failed?.status === 'rejected') throw failed.reason;
        }
        stage = 'completion';
        const result = build();
        const waiting = result.pending.names.length + result.pending.reviews.length;
        if (waiting) throw new Error('Processing is incomplete');
        return { ...result.records, model: { state: 'ready', name: this.model!.name, waiting: 0, message: null } };
      } catch {
        // Log progress, never report text or provider bodies that may echo it.
        this.log.warn(`Processing failed during ${stage}: documents=${docs.length}, mappingCalls=${mappingCalls}, reviewed=${reviewed}, elapsedMs=${Date.now() - started}`);
        throw new HttpException('Results processing did not finish. Please try again.', 502);
      }
    });
  }

  @Post('recovery')
  async recover(@Body() body: any) {
    const document = parseDocument(body?.document);
    const page = body?.page;
    if (!Number.isInteger(page) || !document.pages[page]) throw new BadRequestException('Choose a valid source page.');
    if (!this.model) throw new HttpException('No Meta model is configured.', 503);
    const existing = extractDocument(document).observations;
    // Accepted proposals from this browser prevent the same source words being proposed again.
    if (Array.isArray(body.acceptedEvidence)) for (const item of body.acceptedEvidence.slice(0, 120)) {
      const verified = verifyEvidence(document, item?.page, item?.evidence, existing);
      if (verified.ok) existing.push(verified.observation);
    }
    let task;
    try { task = recoveryTask(document, page, existing); }
    catch (error) { throw new BadRequestException((error as Error).message); }
    return this.bounded(async () => {
      try {
        const answer = validateAnswer<RecoveryAnswer>(task, await this.model!.ask(task));
        const sourceRevision = recoverySourceRevision(document);
        const proposals = [];
        for (const row of answer.rows) {
          const { page: index, ...evidence } = row;
          const verified = verifyEvidence(document, index, evidence, existing);
          if (!verified.ok) continue;
          const proposal = presentProposal(document, {
            id: recoveryProposalId(sourceRevision, index, evidence), page: index, evidence, state: 'pending',
            model: this.model!.name, createdAt: new Date().toISOString(), decision: null,
          }, existing, sourceRevision);
          if (proposal) { proposals.push(proposal); existing.push(verified.observation); }
        }
        return { sourceRevision, proposals, modelName: this.model!.name, limits: RECOVERY_LIMITS };
      } catch { throw new HttpException('The Meta source check could not finish. Your saved readings are unchanged.', 502); }
    });
  }

  private async bounded<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= 4) throw new HttpException('AI checks are busy. Try again shortly.', 429);
    this.active++;
    try { return await work(); }
    finally { this.active--; }
  }
}

function parseDocument(input: any): SavedDocument {
  try {
    const manifest = parseManifest(JSON.stringify(input));
    const id = typeof input.id === 'string' && /^[\w-]{1,80}$/.test(input.id) ? input.id : randomUUID();
    const updatedAt = typeof input.updatedAt === 'string' && Number.isFinite(Date.parse(input.updatedAt)) ? input.updatedAt : new Date().toISOString();
    return { ...manifest, id, pageCount: manifest.pages.length, createdAt: updatedAt, updatedAt };
  } catch { throw new BadRequestException('The approved source document is invalid. Reopen it and try again.'); }
}

function parseRecords(body: any): BuildDocument[] {
  if (!Array.isArray(body?.documents) || body.documents.length > 100) throw new BadRequestException('Send at most 100 documents per check.');
  let count = 0;
  try {
    return body.documents.map((doc: any) => {
      if (typeof doc?.id !== 'string' || doc.id.length > 100 || typeof doc.name !== 'string' || doc.name.length > 120 || !Array.isArray(doc.observations)) throw new Error();
      const observations: Observation[] = doc.observations.map((o: any) => {
        if (++count > 5000 || typeof o?.id !== 'string' || o.id.length > 200 || o.documentId !== doc.id
          || !Number.isInteger(o.page) || o.page < 0 || o.page >= 40
          || typeof o.name !== 'string' || !o.name.trim() || o.name.length > 200
          || typeof o.valueText !== 'string' || o.valueText.length > 100
          || !(o.unit === null || (typeof o.unit === 'string' && o.unit.length <= 60))
          || !(o.date === null || (typeof o.date === 'string' && toIsoDate(o.date, 'YMD') === o.date))) throw new Error();
        const parsed = parseNumber(o.valueText);
        return { id: o.id, documentId: doc.id, page: o.page, words: [], name: o.name, valueText: o.valueText,
          value: parsed?.value ?? null, comparator: parsed?.comparator ?? null, unit: o.unit, date: o.date,
          dateSource: o.date ? 'user' : null, refLow: null, refHigh: null, flag: null,
          refText: typeof o.refText === 'string' ? o.refText.slice(0, 200) : null,
          bbox: Array.isArray(o.bbox) && o.bbox.length === 4 && o.bbox.every((n: unknown) => typeof n === 'number' && Number.isFinite(n)) ? o.bbox : null,
          confirmed: o.confirmed === true, revision: typeof o.revision === 'string' ? o.revision.slice(0, 100) : undefined };
      });
      return { id: doc.id, name: doc.name, observations, review: null };
    });
  } catch { throw new BadRequestException('The result snapshot is invalid. Reload your saved results.'); }
}

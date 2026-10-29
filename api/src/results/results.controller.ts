import { Body, Controller, Get, Inject, Logger, NotFoundException, Param, Patch, Req, UseGuards } from '@nestjs/common';
import { TestScopeGuard, type AuthedRequest } from '../testing/request-scope.guard.js';
import { STORAGE } from '../documents/storage.token.js';
import { DocumentStorage, NotFoundError } from '../documents/storage.js';
import type { DocumentResults, Observation, ResultsResponse } from './contract.js';
import { EXTRACTOR_VERSION, extractDocument } from './extract.js';
import { addCorrection, applyCorrections, validateCorrection, type CorrectionLedger } from './corrections.js';
import type { RecoveryLedger } from '../recovery/contract.js';
import { acceptedRecoveryObservations } from '../recovery/verify.js';

/** Every printed result across the user's documents, each with its source location. */
@Controller('results')
@UseGuards(TestScopeGuard)
export class ResultsController {
  private readonly log = new Logger('Results');

  constructor(@Inject(STORAGE) private readonly storage: DocumentStorage) {}

  @Get()
  async all(@Req() req: AuthedRequest): Promise<ResultsResponse> {
    const summaries = await this.storage.list(req.userId);
    const response: ResultsResponse = { documents: [], observations: [], issues: [] };
    for (const s of summaries) {
      const results = await resultsFor(this.storage, req.userId, s.id, this.log);
      if (!results) {
        response.issues!.push({ documentId: s.id, documentName: s.name, message: 'We could not read the results from this document. Open it to check the source, then try again.' });
        continue;
      }
      if (!results.observations.length) response.issues!.push({ documentId: s.id, documentName: s.name, message: 'No result rows could be read from this document. Check that its pages are clear and contain a readable results table.' });
      response.documents.push({
        id: s.id,
        name: s.name,
        sourceKind: s.sourceKind,
        pageCount: s.pageCount,
        locale: results.locale,
        count: results.observations.length,
      });
      response.observations.push(...results.observations);
    }
    return response;
  }

  @Patch(':documentId/observations/:observationId')
  async correct(@Req() req: AuthedRequest, @Param('documentId') documentId: string, @Param('observationId') observationId: string, @Body() body: unknown): Promise<Observation> {
    const request = validateCorrection(body);
    let updated: Observation | undefined;
    try {
      await this.storage.updateExtra<CorrectionLedger>(req.userId, documentId, 'corrections', async (ledger) => {
        // Re-read inside the document lock: a redaction replacement must not race this edit.
        const doc = await this.storage.read(req.userId, documentId);
        const original = extractDocument(doc).observations;
        const recovery = await this.storage.readExtra<RecoveryLedger>(req.userId, documentId, 'recovery');
        const source = [...original, ...acceptedRecoveryObservations(doc, recovery, original)].find((o) => o.id === observationId);
        if (!source) throw new NotFoundException('This reading is no longer available.');
        const next = addCorrection(source, ledger, request);
        updated = applyCorrections(source, next);
        return next;
      });
    } catch (error) {
      if (error instanceof NotFoundError) throw new NotFoundException('This document is no longer available.');
      throw error;
    }
    return updated!;
  }
}

/** Cached results, recomputed when missing or made by an older extractor. */
export async function resultsFor(storage: DocumentStorage, userId: string, id: string, log?: Logger): Promise<DocumentResults | null> {
  try {
    return await storage.withDocumentLock(userId, id, async () => {
      const doc = await storage.read(userId, id);
      const cached = await storage.readResults(userId, id);
      const results = cached?.extractorVersion === EXTRACTOR_VERSION ? cached : extractDocument(doc);
      if (results !== cached) await storage.writeResults(userId, id, results);
      const ledger = await storage.readExtra<CorrectionLedger>(userId, id, 'corrections');
      const recovery = await storage.readExtra<RecoveryLedger>(userId, id, 'recovery');
      const sources = [...results.observations, ...acceptedRecoveryObservations(doc, recovery, results.observations)];
      return { ...results, observations: sources.map((o) => applyCorrections(o, ledger)) };
    });
  } catch {
    log?.warn('Result extraction failed for a saved document.');
    return null;
  }
}

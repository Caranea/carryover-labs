import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { DocumentStorage } from '../documents/storage.js';
import { resultsFor } from '../results/results.controller.js';
import { buildRecords, type BuildDocument, type Pending, type Review } from './build.js';
import { CATALOGUE, DOMAINS, type CatalogueTest, type Domain } from './catalogue.js';
import type { ModelStatus, RecordsResponse } from './contract.js';
import type { KnowledgeStore } from './knowledge.js';
import type { JsonModel } from './muse.js';
import { mapNamesTask, reviewTask } from './prompts.js';
import { conversionFactor, parseUnit } from './units.js';

const NAMES_PER_CALL = 40;
const MAX_MODEL_CALLS = 8;
interface Job {
  state: 'working' | 'ready' | 'error';
  message: string | null;
  fingerprint: string;
}

/** Account-scoped suggestions, bounded jobs and explicit retry after a failed check. */
export class RecordsService {
  private readonly log = new Logger('Records');
  private readonly jobs = new Map<string, Job>();

  constructor(
    private readonly storage: DocumentStorage,
    private readonly knowledge: KnowledgeStore | ((userId: string) => KnowledgeStore),
    private readonly model: JsonModel | null,
  ) {}

  private store(userId: string): KnowledgeStore {
    return typeof this.knowledge === 'function' ? this.knowledge(userId) : this.knowledge;
  }

  async records(userId: string): Promise<RecordsResponse> {
    const store = this.store(userId);
    const { records, pending } = await this.build(userId, store);
    const waiting = this.count(pending);
    const fingerprint = this.fingerprint(pending);
    let job = this.jobs.get(userId);
    if (this.model && waiting > 0 && job?.state !== 'working' && (!job || job.fingerprint !== fingerprint)) {
      job = { state: 'working', message: null, fingerprint };
      this.jobs.set(userId, job);
      void this.run(userId, job, store);
    }
    const model: ModelStatus = !this.model
      ? { state: 'off', name: null, waiting: 0, message: null }
      : { state: job?.state === 'working' ? 'working' : waiting > 0 && job?.state === 'error' ? 'error' : 'ready', name: this.model.name, waiting, message: waiting ? job?.message ?? null : null };
    return { ...records, model };
  }

  async retry(userId: string): Promise<RecordsResponse> {
    if (this.jobs.get(userId)?.state !== 'working') this.jobs.delete(userId);
    return this.records(userId);
  }

  private async build(userId: string, store: KnowledgeStore) {
    const docs: BuildDocument[] = [];
    const issues: NonNullable<RecordsResponse['issues']> = [];
    for (const s of await this.storage.list(userId)) {
      const results = await resultsFor(this.storage, userId, s.id, this.log);
      if (!results) {
        issues.push({ documentId: s.id, documentName: s.name, message: 'We could not read the results from this document. Open it to check the source, then try again.' });
        continue;
      }
      if (!results.observations.length) issues.push({ documentId: s.id, documentName: s.name, message: 'No result rows could be read from this document. Check that its pages are clear and contain a readable results table.' });
      const review = await this.storage.readExtra<Review>(userId, s.id, 'review');
      docs.push({ id: s.id, name: s.name, observations: results.observations, review });
    }
    const built = buildRecords(docs, await store.get(), !!this.model);
    built.records.issues = issues;
    return built;
  }

  private count(p: Pending): number {
    return p.names.length + p.reviews.length;
  }

  private fingerprint(p: Pending): string {
    return createHash('sha256').update(JSON.stringify([p.names, p.reviews.map((r) => [r.documentId, r.hash])])).digest('hex');
  }

  private async run(userId: string, job: Job, store: KnowledgeStore): Promise<void> {
    try {
      // Pin the account knowledge generation before the first external request.
      await store.get();
      for (let call = 0; call < MAX_MODEL_CALLS; call++) {
        const { pending } = await this.build(userId, store);
        if (!this.count(pending)) break;
        if (pending.names.length) {
          const seen = new Set<string>();
          const batch = pending.names.filter((n) => {
            if (seen.has(n.printedName) || seen.size >= NAMES_PER_CALL) return false;
            seen.add(n.printedName);
            return true;
          });
          await this.mapNames(batch, store);
        } else await this.review(userId, pending.reviews[0], store);
      }
      const { pending } = await this.build(userId, store);
      job.fingerprint = this.fingerprint(pending);
      job.state = this.count(pending) ? 'error' : 'ready';
      job.message = this.count(pending) ? 'Some automatic checks are still waiting. Your saved readings are available. Choose Retry checks to continue.' : null;
    } catch {
      job.state = 'error';
      job.message = 'The automatic check could not finish. Your saved readings are available. Choose Retry checks to try again.';
      // Keep the remaining-work fingerprint so a polling GET cannot start an endless retry loop.
      try { job.fingerprint = this.fingerprint((await this.build(userId, store)).pending); } catch { /* preserve the original fingerprint */ }
      this.log.warn('An automatic records check could not finish.');
    }
  }

  private async mapNames(names: Pending['names'], store: KnowledgeStore): Promise<void> {
    const k = await store.get();
    const answer = await this.model!.ask<{ answers: NameAnswer[] }>(mapNamesTask(names, [...CATALOGUE, ...k.tests]));
    const byPrinted = new Map(answer.answers.map((a) => [a.name, a]));
    if (byPrinted.size !== names.length || names.some((n) => !byPrinted.has(n.printedName))) throw new Error('The automatic check returned mismatched names.');
    await store.update((knowledge) => {
      for (const n of names) {
        const a = byPrinted.get(n.printedName);
        const decision = a ? decideName(a, [...CATALOGUE, ...knowledge.tests]) : null;
        if (!decision) throw new Error('The automatic check did not return a usable mapping.');
        if (decision.newTest) knowledge.tests.push(decision.newTest);
        knowledge.names[n.name] = { key: decision.key, reason: decision.reason };
      }
    });
  }

  private async review(userId: string, r: Pending['reviews'][number], store: KnowledgeStore): Promise<void> {
    const answer = await this.model!.ask<{ flags: { row: number; reason: string }[] }>(reviewTask(r.rows));
    const flags = answer.flags
      .filter((f) => Number.isInteger(f.row) && f.row >= 1 && f.row <= r.rows.length)
      .map((f) => ({ id: r.rows[f.row - 1].id, reason: String(f.reason).slice(0, 300) }));
    await this.storage.withDocumentLock(userId, r.documentId, async () => {
      // Redaction/correction/deletion during inference invalidates the response.
      const current = (await this.build(userId, store)).pending.reviews.find((candidate) => candidate.documentId === r.documentId);
      if (current?.hash !== r.hash) return;
      await this.storage.writeExtra(userId, r.documentId, 'review', { hash: r.hash, flags } satisfies Review);
    });
  }
}

interface NameAnswer {
  name: string;
  key: string | null;
  newTest: { key: string; label: string; domain: string; unit: string } | null;
  notATest: boolean;
  reason: string;
}

/** Keep a mapping only if it points at a real catalogue test or a well-formed new one. */
export function decideName(a: NameAnswer, tests: CatalogueTest[]): { key: string | null; reason: string; newTest?: CatalogueTest } | null {
  const reason = String(a.reason ?? '').slice(0, 200);
  if (a.notATest) return a.key === null && a.newTest === null ? { key: null, reason: reason || 'Not a lab test name' } : null;
  if (a.key && a.newTest) return null;
  if (a.key && tests.some((t) => t.key === a.key)) return { key: a.key, reason };
  const n = a.newTest;
  if (n && /^[a-z0-9][a-z0-9-]{1,40}$/.test(n.key) && n.label?.trim() && DOMAINS.some((d) => d.key === n.domain)) {
    const existing = tests.find((t) => t.key === n.key);
    if (existing) return { key: existing.key, reason };
    const newTest: CatalogueTest = { key: n.key, label: n.label.trim().slice(0, 60), domain: n.domain as Domain, unit: String(n.unit ?? '').slice(0, 30), aliases: [] };
    return { key: n.key, reason, newTest };
  }
  return null;
}

/** Models cannot authorize numeric conversions; independent unit arithmetic must agree. */
export function validFactor(factor: unknown, c: Pending['conversions'][number]): factor is number {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return false;
  const from = parseUnit(c.from), to = parseUnit(c.to), home = parseUnit(c.test.unit);
  if (!from || !to || !home || conversionFactor(from, home, c.test.molarMass) === null) return false;
  const verified = conversionFactor(from, to, c.test.molarMass);
  return verified !== null && Math.abs(factor - verified) <= Math.abs(verified) * 1e-12;
}

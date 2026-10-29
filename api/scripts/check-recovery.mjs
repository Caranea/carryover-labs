// No external calls without --live. The only source is the invented fixture in this file.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig } from '../dist/config.js';
import { DocumentStorage } from '../dist/documents/storage.js';
import { buildRecords } from '../dist/records/build.js';
import { MuseSpark } from '../dist/records/muse.js';
import { RecoveryService } from '../dist/recovery/recovery.service.js';
import { verifyEvidence } from '../dist/recovery/verify.js';
import { extractDocument } from '../dist/results/extract.js';
import { resultsFor } from '../dist/results/results.controller.js';

class CheckFailure extends Error { constructor(code) { super(code); this.code = code; } }
function ensure(condition, code) { if (!condition) throw new CheckFailure(code); }

const args = process.argv.slice(2);
if (args.some((arg) => arg !== '--live') || args.filter((arg) => arg === '--live').length > 1) {
  console.error('Usage: node api/scripts/check-recovery.mjs [--live]');
  process.exitCode = 2;
} else {
  await check(args.includes('--live'));
}

async function check(live) {
  Logger.overrideLogger(false);
  const project = fileURLToPath(new URL('../../', import.meta.url));
  const reportPath = join(project, 'artifacts', `synthetic-recovery-${live ? 'live' : 'stub'}.json`);
  const report = {
    fixture: 'invented-split-row-tsh-v1',
    mode: live ? 'live' : 'stub',
    startedAt: new Date().toISOString(),
    configuredModels: [],
    logicalModelCalls: 0,
    networkRequests: [],
    modelMilliseconds: 0,
    totalMilliseconds: 0,
    deterministicRows: 0,
    modelProposedRows: null,
    verifierRejections: {},
    verifiedProposals: 0,
    acceptedRows: 0,
    chartPoints: 0,
    encryptedFiles: 0,
    sourceUnchanged: null,
    originalReadingUnchanged: null,
    outcome: 'failed',
    failureStage: null,
    failureCode: null,
    temporaryStorageRemoved: null,
  };
  let stage = 'configuration', workRoot;
  let evidenceContext;
  const key = randomBytes(32);
  const originalFetch = globalThis.fetch;
  const began = performance.now();
  try {
    let model;
    if (live) {
      // Only endpoint settings are used. The configured document directory is never opened.
      const config = loadConfig();
      ensure(config.models.length > 0, 'no-configured-provider');
      report.configuredModels = config.models.map(({ name, model }) => ({ provider: name, model }));
      globalThis.fetch = async (input, options) => {
        const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const endpoint = config.models.find((candidate) => requestUrl === `${candidate.baseUrl.replace(/\/$/, '')}/chat/completions`);
        ensure(endpoint, 'unexpected-network-destination');
        const request = { provider: endpoint.name, model: endpoint.model, status: null, milliseconds: 0 };
        report.networkRequests.push(request);
        const start = performance.now();
        try { const response = await originalFetch(input, options); request.status = response.status; return response; }
        finally { request.milliseconds = Math.round(performance.now() - start); }
      };
      model = new MuseSpark(config.models);
    } else {
      // Do not even load .env in stub mode. Refuse any accidental network request.
      globalThis.fetch = async () => { throw new CheckFailure('network-disabled-in-stub-mode'); };
      model = { name: 'Synthetic stub (no network)', async ask() { return { rows: [{ page: 0, name: [2], value: [3], unit: [4], date: [1], reference: [5, 6, 7] }] }; } };
      report.configuredModels = [{ provider: 'Synthetic stub', model: 'no-network' }];
    }
    const countedModel = { name: model.name, async ask(task) {
      ensure(task.kind === 'recover-source-rows', 'unexpected-model-task');
      report.logicalModelCalls++;
      const start = performance.now();
      try {
        const answer = await model.ask(task);
        if (Array.isArray(answer?.rows)) {
          report.modelProposedRows = answer.rows.length;
          if (evidenceContext) for (const candidate of answer.rows) {
            const { page, ...evidence } = candidate;
            const checked = verifyEvidence(evidenceContext.source, page, evidence, evidenceContext.observations);
            if (!checked.ok) report.verifierRejections[checked.reason] = (report.verifierRejections[checked.reason] ?? 0) + 1;
          }
        }
        return answer;
      }
      finally { report.modelMilliseconds += Math.round(performance.now() - start); }
    } };

    stage = 'isolated-encrypted-storage';
    workRoot = await mkdtemp(join(resolve(tmpdir()), 'carryover-synthetic-recovery-'));
    const storage = new DocumentStorage(workRoot, key);
    const user = 'invented-recovery-check';
    const summary = await storage.create(user, inventedFixture(), new Map());
    const source = await storage.read(user, summary.id);
    const sourceBytes = JSON.stringify(source);
    const extracted = extractDocument(source);
    evidenceContext = { source, observations: extracted.observations };
    report.deterministicRows = extracted.observations.length;
    ensure(report.deterministicRows === 0, 'fixture-no-longer-demonstrates-missed-row');
    const recovery = new RecoveryService(storage, countedModel);
    const initial = await recovery.status(user, summary.id);
    ensure(initial.status === 'idle' && report.logicalModelCalls === 0, 'status-started-inference');

    stage = 'explicit-model-recovery';
    await recovery.start(user, summary.id, { page: 0, expectedRevision: initial.sourceRevision });
    let state;
    const waitStarted = performance.now();
    do {
      await delay(100);
      state = await recovery.status(user, summary.id);
      ensure(performance.now() - waitStarted < 70_000, 'recovery-did-not-settle');
    } while (state.status === 'working');
    ensure(state.status === 'ready', 'provider-or-response-check-failed');
    ensure(report.logicalModelCalls === 1, 'unexpected-model-call-count');

    stage = 'source-evidence-verification';
    report.verifiedProposals = state.proposals.length;
    ensure(state.proposals.length === 1, 'expected-one-verified-proposal');
    const proposal = state.proposals[0];
    const verified = verifyEvidence(source, proposal.page, proposal.evidence, extracted.observations);
    ensure(verified.ok, 'proposal-evidence-not-verifiable');
    ensure(proposal.name === 'TSH' && proposal.valueText === '1,50' && proposal.unit === 'mIU/L' && proposal.date === '2024-01-01', 'proposal-missing-or-changed-core-fields');
    const beforeAcceptance = await resultsFor(storage, user, summary.id);
    ensure(beforeAcceptance?.observations.length === 0, 'unconfirmed-proposal-entered-results');

    stage = 'explicit-confirmation';
    const accepted = await recovery.decide(user, summary.id, proposal.id, 'accepted', { expectedRevision: proposal.revision, note: 'Synthetic verification: selected fields match the invented fixture exactly.' });
    ensure(accepted.proposals[0]?.state === 'accepted', 'confirmation-not-persisted');
    const results = await resultsFor(storage, user, summary.id);
    report.acceptedRows = results?.observations.length ?? 0;
    ensure(report.acceptedRows === 1, 'accepted-row-not-visible');
    const reading = results.observations[0];
    report.originalReadingUnchanged = reading.valueText === '1,50' && reading.value === 1.5 && reading.original?.valueText === '1,50';
    ensure(report.originalReadingUnchanged && reading.confirmed === true && reading.recovery?.proposalId === proposal.id, 'reading-or-provenance-changed');
    report.sourceUnchanged = JSON.stringify(await storage.read(user, summary.id)) === sourceBytes;
    ensure(report.sourceUnchanged, 'source-was-modified');
    ensure((await storage.readResults(user, summary.id))?.observations.length === 0, 'deterministic-cache-was-modified');
    const records = buildRecords([{ id: summary.id, name: summary.name, observations: results.observations, review: null }], { version: 1, names: {}, tests: [], conversions: {} }, false).records;
    report.chartPoints = records.stats.values;
    ensure(report.chartPoints === 1 && records.domains[0].charts[0].series[0].points[0].value === 1.5, 'accepted-value-not-preserved-in-chart');

    stage = 'storage-verification';
    for (const path of await storedFiles(workRoot)) {
      ensure((await readFile(path)).subarray(0, 5).equals(Buffer.from('CLAB1')), 'unencrypted-storage-payload');
      report.encryptedFiles++;
    }
    ensure(report.encryptedFiles >= 3, 'missing-encrypted-artifacts');
    ensure(live || report.networkRequests.length === 0, 'stub-mode-made-network-request');
    report.outcome = 'passed';
  } catch (error) {
    report.failureStage = stage;
    // Never print provider response bodies, credentials, endpoint URLs or an error that may echo them.
    report.failureCode = error instanceof CheckFailure ? error.code : 'unexpected-local-or-provider-error';
    process.exitCode = 1;
  } finally {
    globalThis.fetch = originalFetch;
    if (workRoot) {
      const root = resolve(workRoot), parent = resolve(tmpdir());
      if (root.startsWith(parent + sep) && basename(root).startsWith('carryover-synthetic-recovery-')) {
        try { await rm(root, { recursive: true, force: true }); report.temporaryStorageRemoved = true; }
        catch { report.outcome = 'failed'; report.failureStage = 'cleanup'; report.failureCode = 'temporary-storage-cleanup-failed'; process.exitCode = 1; }
      } else {
        report.outcome = 'failed'; report.failureStage = 'cleanup'; report.failureCode = 'unexpected-temporary-path'; process.exitCode = 1;
      }
    }
    key.fill(0);
    report.totalMilliseconds = Math.round(performance.now() - began);
    await mkdir(join(project, 'artifacts'), { recursive: true });
    const json = JSON.stringify(report, null, 2) + '\n';
    await writeFile(reportPath, json);
    await writeFile(join(project, 'artifacts', `synthetic-recovery-${live ? 'live' : 'stub'}-${report.startedAt.replace(/[:.]/g, '-')}.json`), json);
    console.log(JSON.stringify(report));
  }
}

function inventedFixture() {
  const word = (t, l, x) => ({ t, l, b: [x, 20 + l * 30, Math.max(12, t.length * 8), 18] });
  return { name: 'Entirely invented recovery fixture', sourceKind: 'text', hiddenCount: 0, pages: [{ index: 0, width: 600, height: 200, hasImage: false, ocr: false, regions: [], words: [
    word('Collected', 0, 40), word('2024-01-01', 0, 150), word('TSH', 2, 40),
    word('1,50', 3, 40), word('mIU/L', 3, 130), word('0,35', 3, 240), word('–', 3, 290), word('4,94', 3, 320),
  ] }] };
}

async function storedFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await storedFiles(path));
    else if (entry.isFile()) files.push(path);
    else throw new CheckFailure('unexpected-storage-entry');
  }
  return files;
}


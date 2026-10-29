import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';
import type { SavedDocument } from '../documents/contract.js';
import { LIMITS, parseManifest } from '../documents/validate.js';
import { EXTRACTOR_VERSION, extractDocument } from '../results/extract.js';
import { recoveryProposalId, recoverySourceRevision, verifyEvidence, acceptedRecoveryObservations } from '../recovery/verify.js';
import type { RecoveryLedger } from '../recovery/contract.js';
import { decodeStored, encodeStored } from './storage-crypto.js';

const ACCOUNT = /^[a-f0-9]{40}$/;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const MAX_FILE_BYTES = 32 * 1024 * 1024;
const KNOWN_EXTRAS = ['results.json', 'review.json', 'corrections.json', 'recovery.json'];
const digest = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const boundedText = (value: unknown, max: number, empty = false) => typeof value === 'string' && value.length <= max && (empty || !!value.trim()) && !/[\u0000-\u001f\u007f]/.test(value);

export interface StorageReport {
  accounts: number;
  documents: number;
  files: number;
  encryptedPayloads: number;
  plaintextPayloads: number;
  cacheGenerations: number;
  issues: { code: string; count: number }[];
  verified: boolean;
}
interface Item { path: string; context: string | null; plainHash: string; storedHash: string }
interface Scan { root: string; report: StorageReport; items: Item[]; directories: string[] }
export class StorageOperationError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Read-only inventory: never invokes DocumentStorage, whose startup recovery mutates files. */
export async function inventoryStorage(source: string, key?: Buffer): Promise<StorageReport> {
  return (await scan(source, key)).report;
}

/** Compare logical payloads across encrypted/plaintext copies without printing any content or hashes. */
export async function compareStorage(source: string, destination: string, sourceKey?: Buffer, targetKey?: Buffer): Promise<boolean> {
  const a = await scan(source, sourceKey);
  const b = await scan(destination, targetKey);
  return a.report.verified && b.report.verified && fingerprint(a, false) === fingerprint(b, false);
}

/** Encrypt or rotate into a NEW destination. Input is immutable, including on failure. */
export async function copyEncryptedStorage(options: {
  source: string; destination: string; sourceKey?: Buffer; targetKey: Buffer; apply?: boolean; writersStopped?: boolean;
}): Promise<{ applied: boolean; report: StorageReport }> {
  if (options.targetKey.length !== 32) throw new StorageOperationError('invalid-target-key');
  const initial = await scan(options.source, options.sourceKey);
  const destination = await safeDestination(initial.root, options.destination);
  if (!initial.report.verified) throw new StorageOperationError('source-verification-failed');
  if (!options.apply) return { applied: false, report: initial.report };
  if (!options.writersStopped) throw new StorageOperationError('stop-all-writers-before-copy');
  const stage = join(dirname(destination), '.carryover-migration-' + randomUUID());
  await mkdir(stage, { mode: 0o700 });
  try {
    for (const directory of initial.directories) await mkdir(join(stage, directory), { recursive: true, mode: 0o700 });
    for (const item of initial.items) {
      const stored = await readFile(join(initial.root, item.path));
      if (digest(stored) !== item.storedHash) throw new StorageOperationError('source-changed-during-copy');
      const plain = item.context ? decodeStored(stored, options.sourceKey, item.context) : stored;
      const output = item.context ? encodeStored(plain, options.targetKey, item.context) : plain;
      const file = await open(join(stage, item.path), 'wx', 0o600);
      try { await file.writeFile(output); await file.sync(); } finally { await file.close(); }
    }
    const verified = await scan(stage, options.targetKey);
    const sourceAfter = await scan(initial.root, options.sourceKey);
    if (!verified.report.verified || verified.report.plaintextPayloads || fingerprint(verified, false) !== fingerprint(initial, false)) {
      throw new StorageOperationError('destination-verification-failed');
    }
    if (!sourceAfter.report.verified || fingerprint(sourceAfter, true) !== fingerprint(initial, true)) throw new StorageOperationError('source-changed-during-copy');
    // No existing destination is ever replaced. Keep writers stopped through final cutover.
    if (await exists(destination)) throw new StorageOperationError('destination-already-exists');
    await rename(stage, destination);
    return { applied: true, report: verified.report };
  } finally {
    // Only our freshly-created staging directory is removed, never source or destination.
    await rm(stage, { recursive: true, force: true });
  }
}

async function safeDestination(source: string, requested: string): Promise<string> {
  const path = resolve(requested);
  if (await exists(path)) throw new StorageOperationError('destination-already-exists');
  const parent = await realpath(dirname(path));
  const destination = join(parent, basename(path));
  if (inside(source, destination) || inside(destination, source)) throw new StorageOperationError('source-and-destination-must-be-separate');
  return destination;
}
function inside(parent: string, child: string): boolean {
  const part = relative(parent, child);
  return !part || (!part.startsWith('..' + sep) && part !== '..' && !isAbsolute(part));
}
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
function fingerprint(value: Scan, stored: boolean): string {
  return digest(JSON.stringify([value.directories.toSorted(), value.items.map((i) => [i.path, stored ? i.storedHash : i.plainHash]).sort((a, b) => a[0].localeCompare(b[0]))]));
}

async function scan(requested: string, key?: Buffer): Promise<Scan> {
  const original = await lstat(resolve(requested));
  if (!original.isDirectory() || original.isSymbolicLink()) throw new StorageOperationError('source-must-be-a-real-directory');
  const root = await realpath(resolve(requested));
  const issues = new Map<string, number>();
  const report: StorageReport = { accounts: 0, documents: 0, files: 0, encryptedPayloads: 0, plaintextPayloads: 0, cacheGenerations: 0, issues: [], verified: false };
  const result: Scan = { root, report, items: [], directories: [] };
  const issue = (code: string) => issues.set(code, (issues.get(code) ?? 0) + 1);
  async function entries(path: string) {
    const list = await readdir(join(root, path), { withFileTypes: true });
    return list.filter((entry) => {
      if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) { issue('unsafe-filesystem-entry'); return false; }
      return true;
    });
  }
  async function payload(path: string, context: string | null): Promise<Buffer> {
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_FILE_BYTES) throw new StorageOperationError('unsafe-or-oversized-file');
    const stored = await readFile(join(root, path));
    const plain = context ? decodeStored(stored, key, context) : stored;
    report.files++;
    if (context) {
      if (stored.subarray(0, 5).toString() === 'CLAB1') report.encryptedPayloads++;
      else report.plaintextPayloads++;
    }
    result.items.push({ path, context, plainHash: digest(plain), storedHash: digest(stored) });
    return plain;
  }
  async function document(owner: string, id: string) {
    const directory = join(owner, id);
    result.directories.push(directory);
    report.documents++;
    try {
      const doc = JSON.parse((await payload(join(directory, 'document.json'), owner + '/' + id + '/document.json')).toString()) as SavedDocument;
      const parsed = parseManifest(JSON.stringify(doc));
      if (doc.id !== id || doc.name !== parsed.name || doc.sourceKind !== parsed.sourceKind || !isDeepStrictEqual(doc.pages, parsed.pages) || doc.pageCount !== parsed.pages.length || doc.hiddenCount !== parsed.hiddenCount || !validDate(doc.createdAt) || !validDate(doc.updatedAt)) throw new Error();
      const allowed = new Set(['id', 'name', 'sourceKind', 'pageCount', 'hiddenCount', 'pages', 'createdAt', 'updatedAt']);
      if (Object.keys(doc).some((name) => !allowed.has(name))) throw new Error();
      const files = await entries(directory);
      const expected = new Set(['document.json', ...doc.pages.filter((p) => p.hasImage).map((p) => 'page-' + p.index + '.jpg')]);
      for (const file of files) {
        if (!file.isFile()) { issue('unexpected-document-directory'); continue; }
        if (file.name === 'document.json') continue;
        const path = join(directory, file.name);
        if (expected.has(file.name)) {
          const page = doc.pages.find((p) => 'page-' + p.index + '.jpg' === file.name)!;
          const image = await payload(path, owner + '/' + id + '/' + file.name);
          const decoder = sharp(image, { failOn: 'warning', limitInputPixels: LIMITS.imagePixels });
          const metadata = await decoder.metadata();
          if (metadata.format !== 'jpeg' || metadata.width !== page.width || metadata.height !== page.height || (metadata.pages ?? 1) !== 1) throw new Error();
          await decoder.raw().toBuffer();
        } else if (KNOWN_EXTRAS.includes(file.name)) {
          const value: unknown = JSON.parse((await payload(path, owner + '/' + id + '/' + file.name)).toString());
          let recovery: RecoveryLedger | null = null;
          if (file.name === 'corrections.json' && files.some((f) => f.name === 'recovery.json')) {
            const stored = await readFile(join(root, directory, 'recovery.json'));
            recovery = JSON.parse(decodeStored(stored, key, owner + '/' + id + '/recovery.json').toString()) as RecoveryLedger;
            validateExtra('recovery.json', recovery, doc);
          }
          validateExtra(file.name, value, doc, recovery);
        } else issue(file.name.startsWith('.') ? 'interrupted-extra-write' : 'unknown-document-file');
      }
      for (const name of expected) if (!files.some((f) => f.isFile() && f.name === name)) issue('missing-page-or-manifest');
    } catch (error) { issue(error instanceof StorageOperationError ? error.code : 'document-verification-failed'); }
  }
  async function knowledge(owner: string) {
    const directory = join(owner, '_knowledge');
    result.directories.push(directory);
    try {
      const current = (await payload(join(directory, 'current'), null)).toString().trim();
      if (!ID.test(current)) throw new Error();
      let generationFound = false;
      for (const entry of await entries(directory)) {
        if (entry.isFile() && entry.name === 'current') continue;
        if (!entry.isDirectory() || entry.name !== current) { issue(ID.test(entry.name) ? 'stale-cache-generation' : 'unknown-cache-entry'); continue; }
        generationFound = true;
        report.cacheGenerations++;
        const generation = join(directory, current);
        result.directories.push(generation);
        for (const file of await entries(generation)) {
          if (!file.isFile() || file.name !== 'knowledge.json') { issue('interrupted-or-unknown-cache-file'); continue; }
          const value = JSON.parse((await payload(join(generation, file.name), owner + '/knowledge')).toString());
          if (!object(value) || value.version !== 1 || !object(value.names) || !Array.isArray(value.tests) || !object(value.conversions)) throw new Error();
          if (Object.values(value.names).some((v) => !object(v) || !(v.key === null || boundedText(v.key, 41)) || !(v.reason === undefined || boundedText(v.reason, 200, true)))) throw new Error();
          if (value.tests.some((v: unknown) => !object(v) || typeof v.key !== 'string' || typeof v.label !== 'string' || typeof v.domain !== 'string' || typeof v.unit !== 'string' || !Array.isArray(v.aliases))) throw new Error();
          if (Object.values(value.conversions).some((v) => !object(v) || !Number.isFinite(v.factor) || v.factor <= 0 || !boundedText(v.note, 1000, true))) throw new Error();
        }
      }
      if (!generationFound) issue('missing-cache-generation');
    } catch { issue('cache-verification-failed'); }
  }
  for (const owner of await entries('')) {
    if (!owner.isDirectory() || !ACCOUNT.test(owner.name)) { issue(owner.name === '_shared' ? 'legacy-shared-cache-needs-review' : owner.name.startsWith('.carryover-migration-') ? 'interrupted-migration' : 'unknown-root-entry'); continue; }
    report.accounts++;
    result.directories.push(owner.name);
    for (const item of await entries(owner.name)) {
      if (item.isDirectory() && ID.test(item.name)) await document(owner.name, item.name);
      else if (item.isDirectory() && item.name === '_knowledge') await knowledge(owner.name);
      else issue(/^\.(old|tmp)-/.test(item.name) ? 'interrupted-document-swap' : 'unknown-account-entry');
    }
  }
  report.issues = [...issues].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count }));
  report.verified = report.issues.length === 0;
  return result;
}

function validateExtra(name: string, value: unknown, doc: SavedDocument, recovery: RecoveryLedger | null = null): void {
  if (!object(value)) throw new Error();
  const source = extractDocument(doc);
  if (name === 'results.json') {
    if (value.documentId !== doc.id || value.extractorVersion !== EXTRACTOR_VERSION || !Array.isArray(value.observations) || !isDeepStrictEqual(value, source)) throw new Error();
  } else if (name === 'review.json') {
    if (!/^[a-f0-9]{16}$/.test(value.hash) || !Array.isArray(value.flags) || value.flags.some((f: unknown) => !object(f) || typeof f.id !== 'string' || typeof f.reason !== 'string' || f.reason.length > 300)) throw new Error();
  } else if (name === 'corrections.json') {
    if (value.version !== 1 || !object(value.observations)) throw new Error();
    for (const [id, ledger] of Object.entries(value.observations)) {
      const observation = [...source.observations, ...acceptedRecoveryObservations(doc, recovery, source.observations)].find((o) => o.id === id);
      if (!observation || !object(ledger) || ledger.sourceHash !== digest(JSON.stringify(observation)) || !Array.isArray(ledger.entries) || ledger.entries.length > 100) throw new Error();
      for (const entry of ledger.entries) {
        if (!object(entry) || !validDate(entry.at) || !boundedText(entry.note, 500) || !object(entry.changes) || Object.keys(entry.changes).some((k) => !['name', 'valueText', 'unit', 'date'].includes(k))) throw new Error();
        for (const [field, change] of Object.entries(entry.changes)) {
          if (field === 'name' && !boundedText(change, 200)) throw new Error();
          if (field === 'valueText' && !boundedText(change, 100)) throw new Error();
          if (field === 'unit' && change !== null && !boundedText(change, 60)) throw new Error();
          if (field === 'date' && change !== null && (typeof change !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(change) || new Date(change).toISOString().slice(0, 10) !== change)) throw new Error();
        }
      }
    }
  } else if (name === 'recovery.json') {
    if (value.version !== 1 || value.sourceRevision !== recoverySourceRevision(doc) || !object(value.attempts) || !Array.isArray(value.proposals) || !validDate(value.updatedAt)) throw new Error();
    if (Object.entries(value.attempts).some(([page, count]) => !/^\d+$/.test(page) || !doc.pages[Number(page)] || !Number.isInteger(count) || count < 0 || count > 100)) throw new Error();
    const ids = new Set<string>();
    for (const p of value.proposals) {
      if (!object(p) || !Number.isInteger(p.page) || !doc.pages[p.page] || !object(p.evidence) || !['pending', 'accepted', 'rejected'].includes(p.state) || typeof p.model !== 'string' || p.model.length > 200 || !validDate(p.createdAt)) throw new Error();
      if (p.id !== recoveryProposalId(value.sourceRevision, p.page, p.evidence as any) || ids.has(p.id) || !verifyEvidence(doc, p.page, p.evidence as any, source.observations).ok) throw new Error();
      ids.add(p.id);
      if (p.state === 'pending' ? p.decision !== null : !object(p.decision) || !validDate(p.decision.at) || typeof p.decision.note !== 'string' || p.decision.note.length > 500 || (p.state === 'accepted' && !p.decision.note.trim())) throw new Error();
    }
    if (acceptedRecoveryObservations(doc, value as RecoveryLedger, source.observations).length !== value.proposals.filter((p: any) => p.state === 'accepted').length) throw new Error();
    if (value.job !== null) {
      const job = value.job;
      if (!object(job) || !ID.test(job.id) || !Number.isInteger(job.page) || !doc.pages[job.page] || !['working', 'ready', 'error'].includes(job.state) || !validDate(job.startedAt) || !(job.finishedAt === null || validDate(job.finishedAt)) || !(job.message === null || typeof job.message === 'string')) throw new Error();
      if (job.state === 'working') throw new StorageOperationError('unfinished-recovery-job');
    }
  }
}

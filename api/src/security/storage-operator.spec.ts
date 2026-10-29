import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import type { DocumentManifest } from '../documents/contract.js';
import { DocumentStorage } from '../documents/storage.js';
import { KnowledgeStore } from '../records/knowledge.js';
import { extractDocument } from '../results/extract.js';
import { addCorrection, applyCorrections } from '../results/corrections.js';
import { recoverySourceRevision } from '../recovery/verify.js';
import { compareStorage, copyEncryptedStorage, inventoryStorage } from './storage-operator.js';
import { runStorageCommand } from './storage-cli.js';

const user = 'fictional-storage-test';
const owner = createHash('sha256').update(user).digest('hex').slice(0, 40);
async function fixture(work: (root: string, source: string, id: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'carryover-operator-test-'));
  const source = join(root, 'source');
  try {
    const storage = new DocumentStorage(source);
    const manifest: DocumentManifest = { name: 'Fictional thyroid', sourceKind: 'image', hiddenCount: 0, pages: [{ index: 0, width: 100, height: 100, hasImage: true, ocr: false, regions: [], words: [
      { t: 'TSH', l: 0, b: [5, 10, 20, 10] }, { t: '2.4', l: 0, b: [30, 10, 20, 10] }, { t: 'mIU/L', l: 0, b: [55, 10, 30, 10] },
    ] }] };
    const image = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const saved = await storage.create(user, manifest, new Map([[0, image]]));
    const results = extractDocument(await storage.read(user, saved.id));
    assert.equal(results.observations.length, 1);
    await storage.writeResults(user, saved.id, results);
    await storage.writeExtra(user, saved.id, 'review', { hash: '1234567890abcdef', flags: [] });
    const observation = results.observations[0];
    const current = applyCorrections(observation, null);
    await storage.writeExtra(user, saved.id, 'corrections', addCorrection(observation, null, {
      name: current.name, valueText: current.valueText, unit: current.unit, date: '2020-05-12', note: 'Checked fictional printed collection date', expectedRevision: current.revision!,
    }));
    await storage.writeExtra(user, saved.id, 'recovery', { version: 1, sourceRevision: recoverySourceRevision(await storage.read(user, saved.id)), attempts: {}, proposals: [], job: null, updatedAt: new Date().toISOString() });
    const knowledge = new KnowledgeStore(join(source, owner, '_knowledge'), undefined, owner + '/knowledge');
    await knowledge.update((k) => { k.names['fictional'] = { key: 'tsh' }; });
    await work(root, source, saved.id);
  } finally { await rm(root, { recursive: true, force: true }); }
}
async function bytes(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(path: string) {
    for (const item of await readdir(join(root, path), { withFileTypes: true })) {
      const name = join(path, item.name);
      if (item.isDirectory()) await visit(name);
      else result[name] = createHash('sha256').update(await readFile(join(root, name))).digest('hex');
    }
  }
  await visit('');
  return result;
}

describe('offline encrypted storage operations', () => {
  it('inventories and dry-runs without modifying source or creating the destination', () => fixture(async (root, source) => {
    const before = await bytes(source);
    const report = await inventoryStorage(source);
    assert.equal(report.verified, true);
    assert.equal(report.documents, 1);
    assert.equal(report.plaintextPayloads, 7);
    const destination = join(root, 'encrypted');
    const result = await copyEncryptedStorage({ source, destination, targetKey: randomBytes(32) });
    assert.equal(result.applied, false);
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
    assert.deepEqual(await bytes(source), before);
  }));

  it('encrypts, rotates, and validates a restored backup without changing any source bytes', () => fixture(async (root, source, id) => {
    const before = await bytes(source);
    const keyA = randomBytes(32), keyB = randomBytes(32);
    const encrypted = join(root, 'encrypted'), rotated = join(root, 'rotated'), restored = join(root, 'restored');
    const result = await copyEncryptedStorage({ source, destination: encrypted, targetKey: keyA, apply: true, writersStopped: true });
    assert.equal(result.report.plaintextPayloads, 0);
    assert.equal(result.report.encryptedPayloads, 7);
    assert.equal(await compareStorage(source, encrypted, undefined, keyA), true);
    await copyEncryptedStorage({ source: encrypted, destination: rotated, sourceKey: keyA, targetKey: keyB, apply: true, writersStopped: true });
    assert.equal(await compareStorage(encrypted, rotated, keyA, keyB), true);
    await copyEncryptedStorage({ source: rotated, destination: restored, sourceKey: keyB, targetKey: keyB, apply: true, writersStopped: true });
    assert.equal(await compareStorage(source, restored, undefined, keyB), true);
    assert.equal((await new DocumentStorage(restored, keyB).read(user, id)).name, 'Fictional thyroid');
    assert.deepEqual(await bytes(source), before);
  }));

  it('rejects wrong keys, corruption, existing/nested destinations and unacknowledged live writers', () => fixture(async (root, source, id) => {
    const key = randomBytes(32);
    const encrypted = join(root, 'encrypted');
    await assert.rejects(copyEncryptedStorage({ source, destination: encrypted, targetKey: key, apply: true }), /stop-all-writers/);
    await assert.rejects(copyEncryptedStorage({ source, destination: join(source, 'nested'), targetKey: key }), /separate/);
    await copyEncryptedStorage({ source, destination: encrypted, targetKey: key, apply: true, writersStopped: true });
    await assert.rejects(copyEncryptedStorage({ source, destination: encrypted, targetKey: key }), /already-exists/);
    assert.equal((await inventoryStorage(encrypted, randomBytes(32))).verified, false);
    const path = join(encrypted, owner, id, 'page-0.jpg');
    const data = await readFile(path); data[data.length - 1] ^= 1; await writeFile(path, data);
    assert.equal((await inventoryStorage(encrypted, key)).verified, false);
    assert.equal(await compareStorage(source, encrypted, undefined, key), false);
  }));

  it('reports crash remnants, stale caches and legacy shared storage without deleting them', () => fixture(async (_root, source, id) => {
    await mkdir(join(source, '_shared'));
    await mkdir(join(source, owner, '.old-' + id + '-' + randomUUID()));
    await mkdir(join(source, owner, '_knowledge', randomUUID()));
    await writeFile(join(source, 'Fictional-person-name.txt'), 'must never appear in logs');
    const before = await bytes(source);
    const report = await inventoryStorage(source);
    assert.equal(report.verified, false);
    for (const code of ['legacy-shared-cache-needs-review', 'interrupted-document-swap', 'stale-cache-generation', 'unknown-root-entry']) assert.ok(report.issues.some((i) => i.code === code));
    assert.equal(JSON.stringify(report).includes('Fictional-person'), false);
    assert.deepEqual(await bytes(source), before);
  }));

  it('keeps CLI output free of keys, private filenames and document content', () => fixture(async (root, source) => {
    const key = randomBytes(32).toString('base64');
    const result = await runStorageCommand(['copy-encrypt', '--source', source, '--destination', join(root, 'new')], { STORAGE_TARGET_KEY: key });
    assert.equal(result.exitCode, 0);
    assert.equal(JSON.stringify(result.output).includes(key), false);
    assert.equal(JSON.stringify(result.output).includes('Fictional thyroid'), false);
    assert.equal(JSON.stringify(result.output).includes(source), false);
    const invalid = await runStorageCommand(['inventory', '--source', source], { STORAGE_SOURCE_KEY: 'secret-never-log-this' });
    assert.equal(invalid.exitCode, 2);
    assert.equal(JSON.stringify(invalid.output).includes('secret-never-log-this'), false);
  }));

  it('validates recovery source revisions and refuses unfinished jobs instead of silently copying them', () => fixture(async (_root, source, id) => {
    const path = join(source, owner, id, 'recovery.json');
    const ledger = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...ledger, sourceRevision: '0'.repeat(64) }));
    assert.equal((await inventoryStorage(source)).verified, false);
    await writeFile(path, JSON.stringify({ ...ledger, job: { id: randomUUID(), page: 0, state: 'working', message: null, startedAt: new Date().toISOString(), finishedAt: null } }));
    assert.equal((await inventoryStorage(source)).verified, false);
  }));

  it('validates the HTTPS/single-writer deployment configuration without revealing secrets', () => fixture(async (root, source) => {
    const encoded = randomBytes(32).toString('base64');
    const encrypted = join(root, 'encrypted');
    await copyEncryptedStorage({ source, destination: encrypted, targetKey: Buffer.from(encoded, 'base64'), apply: true, writersStopped: true });
    const env = { STORAGE_ENCRYPTION_KEY: encoded, CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic', CLERK_SECRET_KEY: 'sk_test_synthetic', CLERK_AUTHORIZED_PARTIES: 'https://example.invalid', HOST: '127.0.0.1', TRUST_LOOPBACK_PROXY: 'true' };
    const ready = await runStorageCommand(['readiness', '--source', encrypted], env);
    assert.equal(ready.exitCode, 0);
    assert.ok((ready.output as any).operatorChecksStillRequired.length > 0);
    assert.equal(JSON.stringify(ready.output).includes(encoded), false);
    assert.equal((await runStorageCommand(['readiness', '--source', encrypted], { ...env, CLERK_AUTHORIZED_PARTIES: 'http://example.invalid' })).exitCode, 2);
  }));
});

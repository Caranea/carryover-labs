import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { loadConfig } from '../config.js';
import { decodeStored, encodeStored } from '../security/storage-crypto.js';
import type { DocumentManifest } from './contract.js';
import { DocumentStorage, NotFoundError, StorageQuotaError } from './storage.js';

const user = 'synthetic-user';
const hash = createHash('sha256').update(user).digest('hex').slice(0, 40);
const manifest = (): DocumentManifest => ({ name: 'Lab document', sourceKind: 'text', hiddenCount: 0, pages: [
  { index: 0, width: 0, height: 0, hasImage: false, ocr: false, regions: [], words: [{ t: 'TSH', l: 0 }, { t: '2.4', l: 0 }] },
] });
async function withDirectory(work: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'carryover-storage-test-'));
  try { await work(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}

describe('encrypted storage', () => {
  it('authenticates bytes and account/path context; production requires an external key', () => {
    const key = randomBytes(32), data = Buffer.from('synthetic private contents');
    const encrypted = encodeStored(data, key, 'account/document.json');
    assert.deepEqual(decodeStored(encrypted, key, 'account/document.json'), data);
    assert.throws(() => decodeStored(encrypted, randomBytes(32), 'account/document.json'));
    assert.throws(() => decodeStored(encrypted, key, 'other/document.json'));
    encrypted[encrypted.length - 1] ^= 1;
    assert.throws(() => decodeStored(encrypted, key, 'account/document.json'));
    assert.throws(() => loadConfig({ NODE_ENV: 'production' }), /requires/);
    assert.throws(() => loadConfig({ STORAGE_ENCRYPTION_KEY: 'invalid' }), /32-byte/);
  });

  it('encrypts documents and extras; legacy migration is explicit and preserves source', () => withDirectory(async (dir) => {
    const legacy = new DocumentStorage(dir);
    const saved = await legacy.create(user, manifest(), new Map());
    await legacy.writeExtra(user, saved.id, 'corrections', { notes: 'synthetic detail' });
    const path = join(dir, hash, saved.id, 'document.json');
    assert.equal((await readFile(path)).includes(Buffer.from('TSH')), true);
    const encrypted = new DocumentStorage(dir, randomBytes(32));
    assert.equal((await encrypted.read(user, saved.id)).pages[0].words[0].t, 'TSH');
    // Reading alone must not pretend the historical plaintext has been migrated.
    assert.equal((await readFile(path)).includes(Buffer.from('TSH')), true);
    await encrypted.migrateDocument(user, saved.id);
    assert.equal((await readFile(path)).subarray(0, 5).toString(), 'CLAB1');
    assert.equal((await readFile(path)).includes(Buffer.from('TSH')), false);
    assert.deepEqual(await encrypted.readExtra(user, saved.id, 'corrections'), { notes: 'synthetic detail' });
    assert.equal((await readFile(join(dir, hash, saved.id, 'corrections.json'))).includes(Buffer.from('synthetic detail')), false);
    await assert.rejects(encrypted.read('different-user', saved.id), NotFoundError);
    await assert.rejects(new DocumentStorage(dir, randomBytes(32)).read(user, saved.id));
  }));

  it('serializes correction updates and removes derived sensitive state after redaction', () => withDirectory(async (dir) => {
    const storage = new DocumentStorage(dir, randomBytes(32));
    const saved = await storage.create(user, manifest(), new Map());
    await Promise.all(Array.from({ length: 10 }, () => storage.updateExtra<number>(user, saved.id, 'corrections', (n) => (n ?? 0) + 1)));
    assert.equal(await storage.readExtra(user, saved.id, 'corrections'), 10);
    const cache = join(dir, hash, '_knowledge');
    await mkdir(cache);
    await writeFile(join(cache, 'old'), 'synthetic');
    const hidden = manifest(); hidden.pages[0].words[1] = { t: null, l: 0, h: true }; hidden.hiddenCount = 1;
    await storage.replace(user, saved.id, hidden, new Map());
    assert.equal(await storage.readExtra(user, saved.id, 'corrections'), null);
    assert.equal((await readdir(join(dir, hash))).includes('_knowledge'), false);
    await assert.rejects(storage.replace(user, saved.id, manifest(), new Map()), /cannot be shown/);
  }));

  it('recovers an interrupted swap and enforces quotas without partial writes', () => withDirectory(async (dir) => {
    const storage = new DocumentStorage(dir, undefined, { maxDocuments: 1, maxBytes: 100_000 });
    const saved = await storage.create(user, manifest(), new Map());
    await assert.rejects(storage.create(user, manifest(), new Map()), StorageQuotaError);
    await assert.rejects(storage.writeExtra(user, saved.id, 'corrections', { note: 'x'.repeat(100_000) }), StorageQuotaError);
    assert.equal(await storage.readExtra(user, saved.id, 'corrections'), null);
    const userDir = join(dir, hash);
    await rename(join(userDir, saved.id), join(userDir, '.old-' + saved.id + '-' + randomUUID()));
    await mkdir(join(userDir, '.tmp-' + saved.id + '-' + randomUUID()));
    const recovered = new DocumentStorage(dir);
    assert.equal((await recovered.read(user, saved.id)).name, 'Lab document');
    assert.deepEqual(await readdir(userDir), [saved.id]);
    await recovered.delete(user, saved.id);
    assert.deepEqual(await recovered.list(user), []);
  }));

  it('re-redaction preserves saved pixels even if an upload supplies replacement pixels', () => withDirectory(async (dir) => {
    const storage = new DocumentStorage(dir);
    const m = manifest();
    Object.assign(m.pages[0], { hasImage: true, width: 80, height: 80, words: [], regions: [] });
    const white = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    const red = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#f00' } }).jpeg().toBuffer();
    const saved = await storage.create(user, m, new Map([[0, white]]));
    m.pages[0].regions = [[0, 0, 20, 20]];
    await storage.replace(user, saved.id, m, new Map([[0, red]]));
    const decoded = await sharp(await storage.readPage(user, saved.id, 0)).raw().toBuffer();
    const outside = (50 * 80 + 50) * 3;
    assert.ok(decoded[outside + 1] > 240);
    assert.ok(decoded[(10 * 80 + 10) * 3] < 10);
  }));
});

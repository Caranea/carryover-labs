import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { DocumentResults } from '../results/contract.js';
import { decodeStored, encodeStored } from '../security/storage-crypto.js';
import type { DocumentManifest, SavedDocument, SavedDocumentSummary } from './contract.js';
import { assertOnlyMoreHidden } from './validate.js';
import { sanitizePageImage } from './images.js';

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type ExtraName = 'review' | 'corrections' | 'recovery';
export class NotFoundError extends Error {}
export class StorageQuotaError extends Error {}
export interface StorageLimits { maxDocuments: number; maxBytes: number }

/** Account-isolated files; a configured external key encrypts every payload.
 * Locks are process-local: run one API writer per storage directory.
 * Legacy plaintext stays readable; migrateDocument explicitly rewrites it encrypted.
 */
export class DocumentStorage {
  private readonly locks = new Map<string, Promise<void>>();
  private readonly held = new AsyncLocalStorage<Set<string>>();
  private readonly recovered = new Set<string>();
  constructor(
    private readonly root: string,
    private readonly key?: Buffer,
    private readonly limits: StorageLimits = { maxDocuments: 500, maxBytes: 512 * 1024 * 1024 },
  ) {}

  /** Reentrant, serialized mutations; account scope makes quota checks atomic too. */
  async withDocumentLock<T>(userId: string, id: string, work: () => Promise<T>): Promise<T> {
    this.docDir(userId, id);
    return this.withAccountLock(userId, work);
  }
  async list(userId: string): Promise<SavedDocumentSummary[]> {
    return this.withAccountLock(userId, async () => {
      const ids = (await this.entries(this.userDir(userId))).filter((name) => ID_RE.test(name));
      const docs = await Promise.all(ids.map((id) => this.read(userId, id)));
      return docs.map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }
  async read(userId: string, id: string): Promise<SavedDocument> {
    return this.withDocumentLock(userId, id, async () => {
      const data = await this.readStored(userId, id, 'document.json');
      if (!data) throw new NotFoundError();
      return JSON.parse(data.toString('utf8')) as SavedDocument;
    });
  }
  async readPage(userId: string, id: string, index: number): Promise<Buffer> {
    if (!Number.isInteger(index) || index < 0 || index > 1000) throw new NotFoundError();
    return this.withDocumentLock(userId, id, async () => {
      const data = await this.readStored(userId, id, 'page-' + index + '.jpg');
      if (!data) throw new NotFoundError();
      return data;
    });
  }
  async create(userId: string, manifest: DocumentManifest, images: Map<number, Buffer>): Promise<SavedDocumentSummary> {
    const id = randomUUID();
    return this.withDocumentLock(userId, id, async () => {
      const now = new Date().toISOString();
      const doc: SavedDocument = { id, ...fields(manifest), createdAt: now, updatedAt: now };
      await this.checkQuota(userId, id, doc, images);
      await this.writeAtomically(userId, id, doc, images);
      return summary(doc);
    });
  }
  async replace(userId: string, id: string, manifest: DocumentManifest, _images: Map<number, Buffer>): Promise<SavedDocumentSummary> {
    return this.withDocumentLock(userId, id, async () => {
      const existing = await this.read(userId, id);
      // Recheck under the lock: concurrent redactions must never reveal each other.
      assertOnlyMoreHidden(existing.pages, manifest.pages);
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(existing.updatedAt) + 1)).toISOString();
      const doc: SavedDocument = { ...existing, ...fields(manifest), id, updatedAt };
      // Re-redaction always starts from the already-saved pixels. Incoming pixels cannot restore hidden details elsewhere.
      const preservedImages = new Map<number, Buffer>();
      for (const page of manifest.pages) if (page.hasImage) preservedImages.set(page.index, await sanitizePageImage(await this.readPage(userId, id, page.index), page));
      await this.checkQuota(userId, id, doc, preservedImages);
      await this.clearKnowledge(userId);
      // Derived results, reviews and correction history can contain newly hidden text.
      await this.writeAtomically(userId, id, doc, preservedImages);
      return summary(doc);
    });
  }
  async readResults(userId: string, id: string): Promise<DocumentResults | null> {
    return this.readJson(userId, id, 'results.json');
  }
  async writeResults(userId: string, id: string, results: DocumentResults): Promise<void> {
    await this.writeJson(userId, id, 'results.json', results);
  }
  async readExtra<T>(userId: string, id: string, name: ExtraName): Promise<T | null> {
    return this.readJson(userId, id, name + '.json');
  }
  async writeExtra(userId: string, id: string, name: ExtraName, value: unknown): Promise<void> {
    await this.writeJson(userId, id, name + '.json', value);
  }
  async updateExtra<T>(userId: string, id: string, name: ExtraName, update: (current: T | null) => T | Promise<T>): Promise<T> {
    return this.withDocumentLock(userId, id, async () => {
      await this.read(userId, id);
      const result = await update(await this.readExtra<T>(userId, id, name));
      await this.writeExtra(userId, id, name, result);
      return result;
    });
  }
  async delete(userId: string, id: string): Promise<void> {
    await this.withDocumentLock(userId, id, async () => {
      await this.read(userId, id);
      await this.clearKnowledge(userId);
      await rm(this.docDir(userId, id), { recursive: true, force: true });
    });
  }
  /** Explicit migration only; callers must retain the external key and back up data. */
  async migrateDocument(userId: string, id: string): Promise<void> {
    if (!this.key) throw new Error('An encryption key is required to migrate storage.');
    await this.withDocumentLock(userId, id, async () => {
      const doc = await this.read(userId, id);
      const images = new Map<number, Buffer>();
      for (const p of doc.pages) if (p.hasImage) images.set(p.index, await this.readPage(userId, id, p.index));
      const extras = new Map<string, Buffer>();
      for (const name of ['results.json', 'review.json', 'corrections.json', 'recovery.json']) {
        const value = await this.readStored(userId, id, name);
        if (value) extras.set(name, value);
      }
      await this.writeAtomically(userId, id, doc, images, extras);
    });
  }
  private async readJson<T>(userId: string, id: string, file: string): Promise<T | null> {
    return this.withDocumentLock(userId, id, async () => {
      const data = await this.readStored(userId, id, file);
      return data ? JSON.parse(data.toString('utf8')) as T : null;
    });
  }
  private async writeJson(userId: string, id: string, file: string, value: unknown): Promise<void> {
    await this.withDocumentLock(userId, id, async () => {
      await this.read(userId, id);
      const target = join(this.docDir(userId, id), file);
      const temporary = target + '.' + randomUUID() + '.tmp';
      const encoded = encodeStored(Buffer.from(JSON.stringify(value)), this.key, this.context(userId, id, file));
      let usedBytes = encoded.length;
      for (const document of (await this.entries(this.userDir(userId))).filter((entry) => ID_RE.test(entry))) {
        const dir = this.docDir(userId, document);
        for (const entry of await readdir(dir, { withFileTypes: true })) {
          if (entry.isFile() && !(document === id && entry.name === file)) usedBytes += (await stat(join(dir, entry.name))).size;
        }
      }
      if (usedBytes > this.limits.maxBytes) throw new StorageQuotaError('Your storage limit has been reached. Delete an unneeded document before saving.');
      try {
        await durableWrite(temporary, encoded);
        await rename(temporary, target);
      } finally { await rm(temporary, { force: true }); }
    });
  }
  private async readStored(userId: string, id: string, file: string): Promise<Buffer | null> {
    let data: Buffer;
    try { data = await readFile(join(this.docDir(userId, id), file)); }
    catch (error) { if (missing(error)) return null; throw error; }
    // Authentication failures are real errors, never mistaken for an empty record.
    return decodeStored(data, this.key, this.context(userId, id, file));
  }
  private async writeAtomically(userId: string, id: string, doc: SavedDocument, images: Map<number, Buffer>, extras = new Map<string, Buffer>()) {
    const userDir = this.userDir(userId);
    const target = this.docDir(userId, id);
    const tmp = join(userDir, '.tmp-' + id + '-' + randomUUID());
    const old = join(userDir, '.old-' + id + '-' + randomUUID());
    await mkdir(tmp, { recursive: true, mode: 0o700 });
    try {
      const files = new Map(extras);
      for (const [index, data] of images) files.set('page-' + index + '.jpg', data);
      files.set('document.json', Buffer.from(JSON.stringify(doc)));
      for (const [file, data] of files) await durableWrite(join(tmp, file), encodeStored(data, this.key, this.context(userId, id, file)));
      let hadOld = false;
      try { await rename(target, old); hadOld = true; }
      catch (error) { if (!missing(error)) throw error; }
      try { await rename(tmp, target); }
      catch (error) { if (hadOld) await rename(old, target); throw error; }
      if (hadOld) await rm(old, { recursive: true, force: true });
    } catch (error) { this.recovered.delete(userDir); throw error; }
    finally { await rm(tmp, { recursive: true, force: true }); }
  }
  private async checkQuota(userId: string, id: string, doc: SavedDocument, images: Map<number, Buffer>): Promise<void> {
    const ids = (await this.entries(this.userDir(userId))).filter((entry) => ID_RE.test(entry) && entry !== id);
    if (ids.length >= this.limits.maxDocuments) throw new StorageQuotaError('Your document limit has been reached. Delete an unneeded document before saving.');
    let bytes = Buffer.byteLength(JSON.stringify(doc)) + [...images.values()].reduce((total, data) => total + data.length + 33, 33);
    for (const existing of ids) {
      const dir = this.docDir(userId, existing);
      for (const entry of await readdir(dir, { withFileTypes: true })) if (entry.isFile()) bytes += (await stat(join(dir, entry.name))).size;
    }
    if (bytes > this.limits.maxBytes) throw new StorageQuotaError('Your storage limit has been reached. Delete an unneeded document before saving.');
  }
  private async clearKnowledge(userId: string): Promise<void> {
    await rm(join(this.userDir(userId), '_knowledge'), { recursive: true, force: true });
  }
  private async withAccountLock<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const dir = this.userDir(userId);
    if (this.held.getStore()?.has(dir)) return work();
    const previous = this.locks.get(dir) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const queued = previous.then(() => gate);
    this.locks.set(dir, queued);
    await previous;
    try {
      return await this.held.run(new Set([...(this.held.getStore() ?? []), dir]), async () => {
        if (!this.recovered.has(dir)) { await this.recover(dir); this.recovered.add(dir); }
        return work();
      });
    } finally { release(); if (this.locks.get(dir) === queued) this.locks.delete(dir); }
  }
  /** Recover an interrupted directory swap before reads on a fresh process. */
  private async recover(dir: string): Promise<void> {
    const names = await this.entries(dir);
    for (const name of names) {
      const match = /^\.(old|tmp)-(.{36})-(.{36})$/.exec(name);
      if (!match || !ID_RE.test(match[2]) || !ID_RE.test(match[3])) continue;
      const source = join(dir, name);
      if (match[1] === 'old' && !names.includes(match[2])) { await rename(source, join(dir, match[2])); names.push(match[2]); }
      else await rm(source, { recursive: true, force: true });
    }
  }
  private async entries(dir: string): Promise<string[]> {
    try { return await readdir(dir); } catch (error) { if (missing(error)) return []; throw error; }
  }
  private context(userId: string, id: string, file: string): string { return this.userHash(userId) + '/' + id + '/' + file; }
  private userHash(userId: string): string { return createHash('sha256').update(userId).digest('hex').slice(0, 40); }
  private userDir(userId: string): string { return join(this.root, this.userHash(userId)); }
  private docDir(userId: string, id: string): string {
    if (!ID_RE.test(id)) throw new NotFoundError();
    return join(this.userDir(userId), id);
  }
}
async function durableWrite(path: string, data: Buffer): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
function missing(error: unknown): boolean { return (error as NodeJS.ErrnoException)?.code === 'ENOENT'; }
function fields(m: DocumentManifest) { return { name: m.name, sourceKind: m.sourceKind, pageCount: m.pages.length, hiddenCount: m.hiddenCount, pages: m.pages }; }
function summary(d: SavedDocument): SavedDocumentSummary { const { pages: _pages, ...rest } = d; return rest; }

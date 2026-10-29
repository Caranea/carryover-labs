import 'reflect-metadata';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { StorageTestModule as AppModule } from '../testing/storage-test.module.js';
import { loadConfig } from '../config.js';
import sharp from 'sharp';
import { securityHeaders } from '../security/http-security.js';

let JPEG: Buffer;

describe('documents API', () => {
  let app: INestApplication;
  let base: string;
  let dir: string;

  before(async () => {
    JPEG = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } }).jpeg().toBuffer();
    dir = await mkdtemp(join(tmpdir(), 'carryover-'));
    const config = { ...loadConfig({ STORAGE_DIR: dir }), storageDir: dir };
    const verifier = async (token: string) => {
      if (!token.startsWith('user:')) throw new Error('bad');
      return { sub: token.slice(5) };
    };
    app = await NestFactory.create(AppModule.forRoot(config, verifier), { logger: false });
    app.setGlobalPrefix('api');
    app.use(securityHeaders);
    await app.listen(0);
    base = `${await app.getUrl()}/api`.replace('[::1]', 'localhost');
  });

  after(async () => {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  });

  const form = (words: unknown[], image = JPEG) => {
    const f = new FormData();
    const positioned = words.map((word, i) => ({ ...(word as object), b: [i * 5, 1, 3, 3] }));
    f.append('manifest', JSON.stringify({ name: 'Morfologia', sourceKind: 'image', hiddenCount: 0, pages: [{ index: 0, width: 10, height: 10, hasImage: true, ocr: true, words: positioned, regions: [] }] }));
    f.append('pages', new Blob([image], { type: 'image/jpeg' }), 'page-0.jpg');
    return f;
  };
  const auth = (user = 'alice') => ({ Authorization: `Bearer user:${user}` });

  it('serves the public config without a token', async () => {
    const res = await fetch(`${base}/config`);
    assert.deepEqual(await res.json(), { storageProtection: 'development-plaintext' });
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
  });

  it('requires a session for documents', async () => {
    assert.equal((await fetch(`${base}/documents`)).status, 401);
    assert.equal((await fetch(`${base}/documents`, { headers: { Authorization: 'Bearer nope' } })).status, 401);
  });

  it('stores, lists, updates and deletes per user', async () => {
    const created = await fetch(`${base}/documents`, { method: 'POST', headers: auth(), body: form([{ t: 'PLT', l: 0 }, { t: null, h: true, l: 0 }]) });
    assert.equal(created.status, 201);
    const { id, hiddenCount } = (await created.json()) as { id: string; hiddenCount: number };
    assert.equal(hiddenCount, 1);

    const list = (await (await fetch(`${base}/documents`, { headers: auth() })).json()) as unknown[];
    assert.equal(list.length, 1);
    assert.equal(((await (await fetch(`${base}/documents`, { headers: auth('bob') })).json()) as unknown[]).length, 0);
    assert.equal((await fetch(`${base}/documents/${id}`, { headers: auth('bob') })).status, 404);

    const img = await fetch(`${base}/documents/${id}/pages/0`, { headers: auth() });
    assert.equal(img.headers.get('content-type'), 'image/jpeg');
    assert.equal(img.headers.get('cache-control'), 'private, no-store');
    assert.equal(img.headers.get('x-content-type-options'), 'nosniff');

    const reveal = await fetch(`${base}/documents/${id}`, { method: 'PUT', headers: auth(), body: form([{ t: 'PLT', l: 0 }, { t: 'Anna', l: 0 }]) });
    assert.equal(reveal.status, 400);
    const more = await fetch(`${base}/documents/${id}`, { method: 'PUT', headers: auth(), body: form([{ t: null, h: true, l: 0 }, { t: null, h: true, l: 0 }]) });
    assert.equal(more.status, 200);

    assert.equal((await fetch(`${base}/documents/${id}`, { method: 'DELETE', headers: auth() })).status, 204);
    assert.equal((await fetch(`${base}/documents/${id}`, { headers: auth() })).status, 404);
  });

  it('refuses a visible PESEL and non-JPEG pages', async () => {
    const pesel = await fetch(`${base}/documents`, { method: 'POST', headers: auth(), body: form([{ t: '44051401359', l: 0 }]) });
    assert.equal(pesel.status, 422);
    const png = await fetch(`${base}/documents`, { method: 'POST', headers: auth(), body: form([{ t: 'x', l: 0 }], Buffer.from('89504e47', 'hex')) });
    assert.equal(png.status, 400);
    const truncated = await fetch(`${base}/documents`, { method: 'POST', headers: auth(), body: form([{ t: 'x', l: 0 }], Buffer.from([0xff, 0xd8, 0xff, 0xe0])) });
    assert.equal(truncated.status, 400);
  });
});

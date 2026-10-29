/** Isolated synthetic HTTP integration. No real Clerk session, patient data or external model calls. */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { AppModule } from '../api/dist/app.module.js';
import { loadConfig } from '../api/dist/config.js';
import { securityHeaders } from '../api/dist/security/http-security.js';

const requireApi = createRequire(new URL('../api/package.json', import.meta.url));
requireApi('reflect-metadata');
const { NestFactory } = requireApi('@nestjs/core');
const sharp = requireApi('sharp');
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'artifacts', 'flow');
await mkdir(out, { recursive: true });
const adapter = join(out, 'adapter.cjs');
await build({ entryPoints: [join(root, 'scripts/flow-adapter.ts')], outfile: adapter, bundle: true, platform: 'node', format: 'cjs', packages: 'external' });
const { createAppointmentPdf } = await import(pathToFileURL(adapter).href);
const temp = await mkdtemp(join(tmpdir(), 'carryover-flow-'));
const checks = [];
let calls = 0;
const model = { name: 'Synthetic test double (not live Meta)', async ask(task) {
  if (task.kind !== 'recover-source-rows') return { flags: [], names: [] };
  calls++;
  return { rows: [{ page: 0, name: [2], value: [3], unit: [4], date: [1], reference: [5, 6, 7] }] };
} };
const config = loadConfig({ STORAGE_DIR: temp, CLERK_PUBLISHABLE_KEY: 'pk_test', STORAGE_ENCRYPTION_KEY: randomBytes(32).toString('base64') });
const verifier = async token => { if (!['synthetic:owner', 'synthetic:other'].includes(token)) throw new Error('invalid test token'); return { sub: token }; };
let app;
try {
  app = await NestFactory.create(AppModule.forRoot(config, verifier, model), { logger: false });
  app.setGlobalPrefix('api'); app.use(securityHeaders); await app.listen(0, '127.0.0.1');
  const base = `${await app.getUrl()}/api`;
  const request = (path, { method = 'GET', body, other = false } = {}) => fetch(base + path, { method, headers: { Authorization: `Bearer synthetic:${other ? 'other' : 'owner'}`, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) }, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const json = async (path, options, status = 200) => { const res = await request(path, options); assert.equal(res.status, status, path); assert.equal(res.headers.get('cache-control'), 'private, no-store'); return res.json(); };
  const upload = async (manifest, jpeg) => {
    const form = new FormData(); form.append('manifest', JSON.stringify(manifest));
    if (jpeg) form.append('pages', new Blob([jpeg], { type: 'image/jpeg' }), 'page-0.jpg');
    return json('/documents', { method: 'POST', body: form }, 201);
  };
  const variant = process.argv.includes('--ocr') ? 'clean' : 'positioned-text';
  const page = JSON.parse(await readFile(join(root, 'artifacts/benchmark', `pl-table-${variant}-visible.json`), 'utf8'));
  assert.equal(page.words.filter(w => w.h).length, 2);
  assert.ok(page.words.filter(w => w.h).every(w => w.t === null));
  const jpeg = await sharp(await readFile(join(root, 'artifacts/benchmark/pl-table.png'))).jpeg().toBuffer();
  // Intentionally unburned synthetic pixels verify the server independently reapplies declared masks.
  const doc = await upload({ name: 'Fictional integration report', sourceKind: 'image', hiddenCount: 2, pages: [page] }, jpeg);
  const source = await json(`/documents/${doc.id}`);
  assert.deepEqual(source.pages, [page]);
  assert.equal((await request(`/documents/${doc.id}`, { other: true })).status, 404);
  assert.equal((await fetch(base + '/documents')).status, 401);
  const storedImage = Buffer.from(await (await request(`/documents/${doc.id}/pages/0`)).arrayBuffer());
  for (const word of page.words.filter(w => w.h)) {
    const [x, y, w, h] = word.b;
    const pixel = await sharp(storedImage).extract({ left: Math.floor(x + w / 2), top: Math.floor(y + h / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.ok([...pixel].every(channel => channel < 12), 'hidden pixels stay black');
  }
  checks.push('redacted manifest, independent image masks, authentication, account isolation and no-store headers');
  const raw = await json('/results');
  assert.equal(raw.observations.length, 3);
  const observed = raw.observations.find(o => o.name === 'TSH'); assert.ok(observed);
  const corrected = await json(`/results/${doc.id}/observations/${observed.id}`, { method: 'PATCH', body: { name: observed.name, valueText: '2,4', unit: 'mIU/L', date: '2020-02-12', note: 'Synthetic check against the invented source image.', expectedRevision: observed.revision } });
  assert.equal(corrected.confirmed, true); assert.equal(corrected.corrections.length, 1);
  assert.equal(corrected.original.valueText, observed.valueText);
  assert.deepEqual((await json(`/documents/${doc.id}`)).pages, source.pages);
  checks.push('source extraction and a revision-checked correction preserve original words');
  const word = (t, l, x) => ({ t, l, b: [x, 20 + l * 30, Math.max(12, t.length * 8), 18] });
  const wrapped = await upload({ name: 'Fictional split row', sourceKind: 'pdf', hiddenCount: 0, pages: [{ index: 0, width: 1200, height: 500, hasImage: false, ocr: false, regions: [], words: [word('Collected', 0, 40), word('2024-01-01', 0, 150), word('TSH', 2, 40), word('1,50', 3, 40), word('mIU/L', 3, 130), word('0,35', 3, 240), word('–', 3, 290), word('4,94', 3, 320)] }] });
  const status = await json(`/recovery/${wrapped.id}`); assert.equal(calls, 0);
  await json(`/recovery/${wrapped.id}`, { method: 'POST', body: { page: 0, expectedRevision: status.sourceRevision } }, 201);
  let recovered;
  for (let i = 0; i < 100; i++) { recovered = await json(`/recovery/${wrapped.id}`); if (recovered.status !== 'working') break; await new Promise(resolve => setTimeout(resolve, 20)); }
  assert.equal(recovered.status, 'ready'); assert.equal(recovered.proposals.length, 1);
  assert.equal((await json('/results')).observations.length, 3, 'pending proposals cannot enter results');
  const proposal = recovered.proposals[0];
  await json(`/recovery/${wrapped.id}/proposals/${proposal.id}/accept`, { method: 'POST', body: { expectedRevision: proposal.revision, note: 'All source fields checked against this invented fixture.' } }, 201);
  const finalRaw = await json('/results');
  assert.equal(finalRaw.observations.length, 4);
  assert.equal(finalRaw.observations.find(o => o.documentId === wrapped.id).valueText, '1,50');
  checks.push('explicit source-index recovery remains pending until acceptance and preserves the decimal');
  const records = await json('/records');
  const points = records.domains.flatMap(d => d.charts.flatMap(c => c.series.flatMap(s => s.points)));
  assert.ok(points.some(p => p.value === 1.5 && p.date === '2024-01-01'));
  const pdf = await createAppointmentPdf({ records, questions: 'Fictional integration test: które wyniki sprawdzić?', preparedAt: '2026-10-29T12:00:00.000Z', fictional: true });
  assert.equal(Buffer.from(pdf).subarray(0, 5).toString(), '%PDF-');
  await writeFile(join(out, `appointment-${variant}.pdf`), pdf);
  checks.push('combined chart records export through the production Unicode PDF engine');
  let encryptedFiles = 0;
  const inspect = async dir => { for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await inspect(path);
    else {
      const bytes = await readFile(path);
      // The cache-generation pointer is an opaque random UUID, never document content.
      if (entry.name === 'current' && dir.endsWith('_knowledge')) assert.match(bytes.toString(), /^[a-f0-9-]{36}$/);
      else { assert.equal(bytes.subarray(0, 5).toString(), 'CLAB1', 'all stored payloads encrypted'); encryptedFiles++; }
    }
  } };
  await inspect(temp); assert.ok(encryptedFiles >= 6);
  checks.push('every stored payload, including corrections and recovery, uses authenticated encryption');
  const report = { syntheticOnly: true, mode: variant, realClerkSignIn: false, liveModel: false, generatedAt: new Date().toISOString(), checks, observations: finalRaw.observations.length, plotted: points.length, encryptedFiles, pdfBytes: pdf.length };
  await writeFile(join(out, `report-${variant}.json`), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} finally {
  await app?.close();
  const within = relative(resolve(tmpdir()), resolve(temp));
  if (!within.startsWith('..') && !isAbsolute(within) && within.startsWith('carryover-flow-')) await rm(temp, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { parsePageRequest, processPage } from './source-processing.js';
import { normalizeBatch } from './normalization.js';
import type { PageRequest, PrintedRow } from '../shared/processing.js';
import type { JsonModel, ModelTask } from '../records/meta-model.js';
import type { SourceDocument } from './normalization.js';

export const printedRow = (patch: Partial<PrintedRow> = {}): PrintedRow => ({
  name: 'CRP',
  value: '<0,6',
  unit: 'mg/L',
  reference: '0-5',
  flag: 'L',
  collectionDate: { printed: '15.10.2026', iso: '2026-10-15' },
  orderDate: { printed: '14.10.2026', iso: '2026-10-14' },
  reportDate: { printed: '16.10.2026', iso: '2026-10-16' },
  specimen: null,
  method: null,
  region: [0.1, 0.2, 0.5, 0.1],
  uncertainty: [],
  ...patch,
});
export const model = (answer: unknown, tasks: ModelTask[] = []): JsonModel => ({
  name: 'Synthetic Meta',
  async ask<T>(task: ModelTask) {
    tasks.push(task);
    return answer as T;
  },
});
export async function pageRequest(): Promise<PageRequest> {
  const pixels = await sharp({
    create: { width: 600, height: 800, channels: 3, background: '#fff' },
  })
    .withMetadata({ exif: { IFD0: { Artist: 'PRIVATE-CAMERA' } } })
    .png()
    .toBuffer();
  return {
    batchId: 'batch-test',
    documentId: 'doc-test',
    pageId: 'doc-test:0',
    page: 0,
    revision: 'revision-test',
    image: `data:image/png;base64,${pixels.toString('base64')}`,
  };
}
async function docs(rows: PrintedRow[]): Promise<SourceDocument[]> {
  const result = await processPage(
    await pageRequest(),
    model({ rows, issues: [], suggestedName: 'Lab results' }),
  );
  return [{ id: result.documentId, name: 'Lab document', observations: result.observations }];
}
const mapping = (ref: string, key: string | null, patch = {}) => ({
  ref,
  key,
  newTest: null,
  specimen: null,
  method: null,
  form: 'other',
  reason: 'Synthetic mapping',
  ...patch,
});

describe('Spark literal image transcription', () => {
  it('uses only a fresh raster, strips metadata, preserves fields and links coordinates to original image pixels', async () => {
    const tasks: ModelTask[] = [];
    const result = await processPage(
      parsePageRequest({
        ...(await pageRequest()),
        originalFileName: 'PRIVATE-FILENAME',
        document: { words: 'PRIVATE-OCR' },
      }),
      model(
        {
          rows: [
            printedRow(),
            printedRow({
              name: null,
              value: null,
              unit: null,
              region: null,
              uncertainty: ['Unreadable row'],
            }),
          ],
          issues: [],
          suggestedName: 'Lab results',
        },
        tasks,
      ),
    );
    assert.equal(tasks[0].model, 'muse-spark-1.3');
    assert.ok(!tasks[0].user.includes('PRIVATE-'));
    const meta = await sharp(Buffer.from(tasks[0].image!.split(',')[1], 'base64')).metadata();
    assert.equal(meta.exif, undefined);
    assert.deepEqual([meta.width, meta.height], [600, 800]);
    const o = result.observations[0];
    assert.deepEqual(
      [o.valueText, o.value, o.comparator, o.unit, o.refText, o.flag],
      ['<0,6', 0.6, '<', 'mg/L', '0-5', 'L'],
    );
    assert.deepEqual(o.bbox, [60, 160, 300, 80]);
    assert.deepEqual(o.words, []);
    assert.deepEqual(o.transcription?.orderDate, printedRow().orderDate);
    assert.equal(o.sourceImage?.pageId, 'doc-test:0');
    assert.equal(result.observations[1].value, null);
  });
  it('never substitutes a report date for a missing collection date', async () => {
    const result = await docs([printedRow({ collectionDate: { printed: null, iso: null } })]);
    assert.equal(result[0].observations[0].date, null);
  });
  it('rejects invalid source geometry and dates instead of repairing guessed fields', async () => {
    for (const row of [
      printedRow({ region: [0.9, 0, 0.9, 0.1] }),
      printedRow({ collectionDate: { printed: null, iso: '2026-10-15' } }),
    ]) {
      await assert.rejects(docs([row]));
    }
    const request = await pageRequest();
    assert.throws(() =>
      parsePageRequest({ ...request, image: 'data:application/pdf;base64,JVBERg==' }),
    );
    const notAnImage = parsePageRequest({ ...request, image: 'data:image/png;base64,JVBERg==' });
    await assert.rejects(processPage(notAnImage, model({})));
  });
});

describe('Wonder mappings and verified unit arithmetic', () => {
  it('preserves comparisons, original references and separate exact/bounded points', async () => {
    const source = await docs([printedRow(), printedRow({ value: '0.6' })]);
    const before = JSON.stringify(source[0].observations),
      tasks: ModelTask[] = [];
    const result = await normalizeBatch(source, model({ mappings: [mapping('t0', 'crp')] }, tasks));
    assert.equal(tasks[0].model, 'muse-wonder-1.0');
    assert.equal(tasks[0].image, undefined);
    assert.equal(JSON.stringify(source[0].observations), before);
    const points = result.domains.flatMap((d) =>
      d.charts.flatMap((c) => c.series.flatMap((s) => s.points)),
    );
    assert.deepEqual(
      points.map((p) => p.comparator),
      ['<', null],
    );
    assert.equal(points[0].printedReference, '0-5');
    assert.equal(points[0].documentId, 'doc-test');
  });
  it('maps equivalent multilingual tests together without mixing counts, percentages, free/total or specimens', async () => {
    const source = await docs([
      printedRow({ name: 'Glukose', value: '90', unit: 'mg/dL', specimen: 'Serum' }),
      printedRow({ name: 'Glucose', value: '5', unit: 'mmol/L', specimen: 'Serum' }),
      printedRow({ name: 'Glucose', value: '5', unit: 'mmol/L', specimen: 'Urine' }),
      printedRow({ name: 'Monocytes', value: '0.4', unit: '10^9/L' }),
      printedRow({ name: 'Monocytes', value: '4', unit: '%' }),
      printedRow({ name: 'Free T4', value: '15', unit: 'pmol/L' }),
      printedRow({ name: 'Total T4', value: '100', unit: 'nmol/L' }),
    ]);
    const result = await normalizeBatch(
      source,
      model({
        mappings: [
          mapping('t0', 'glucose', { specimen: 'serum' }),
          mapping('t1', 'glucose', { specimen: 'serum' }),
          mapping('t2', 'glucose', { specimen: 'urine' }),
          mapping('t3', 'mono', { form: 'absolute' }),
          mapping('t4', 'mono-pct', { form: 'percentage' }),
          mapping('t5', 'ft4', { form: 'free' }),
          mapping('t6', null),
        ],
      }),
    );
    const series = result.domains.flatMap((d) => d.charts.flatMap((c) => c.series));
    assert.equal(series.find((s) => s.label.includes('serum'))?.points.length, 2);
    assert.equal(series.find((s) => s.label.includes('urine'))?.points.length, 1);
    assert.ok(series.some((s) => s.key.startsWith('mono:')));
    assert.ok(series.some((s) => s.key.startsWith('mono-pct:')));
    assert.ok(result.warnings.some((w) => w.printedName === 'Total T4'));
    assert.equal(source[0].observations.length, 7);
  });
  it('keeps ambiguous identities and missing/incompatible/unsupported units visible, and rejects invented factors', async () => {
    const source = await docs([
      printedRow({ unit: null }),
      printedRow({ unit: 'seconds' }),
      printedRow({ unit: 'unknown-unit' }),
      printedRow({ name: 'Ambiguous' }),
    ]);
    const mappings = [
      mapping('t0', 'crp'),
      mapping('t1', 'crp'),
      mapping('t2', 'crp'),
      mapping('t3', null),
    ];
    const result = await normalizeBatch(source, model({ mappings }));
    assert.equal(result.stats.values, 0);
    assert.equal(result.warnings.length, 4);
    await assert.rejects(
      normalizeBatch(source, model({ mappings: mappings.map((m) => ({ ...m, factor: 123 })) })),
    );
    await assert.rejects(normalizeBatch(source, model({ mappings: mappings.slice(1) })));
    await assert.rejects(
      normalizeBatch(source, model({ mappings: [...mappings.slice(1), mappings[1]] })),
    );
  });
  it('rejects obvious form conflicts and never lets catalogue aliases override unresolved Wonder mappings', async () => {
    const source = await docs([
      printedRow({ name: 'Monocytes', unit: '%' }),
      printedRow({ name: 'Free T4', unit: 'pmol/L' }),
      printedRow(),
    ]);
    const result = await normalizeBatch(
      source,
      model({
        mappings: [
          mapping('t0', 'mono', { form: 'absolute' }),
          mapping('t1', 'ft4', { form: 'total' }),
          mapping('t2', null),
        ],
      }),
    );
    assert.equal(result.stats.values, 0);
    assert.equal(result.warnings.length, 3);
  });
});

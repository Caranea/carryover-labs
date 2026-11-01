// Explicit live verification: only the previously reviewed, permanently redacted fixture is sent.
// No original file paths, OCR, identities or provider bodies enter logs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../api/.test-build/config.js';
import { MetaModelClient } from '../api/.test-build/records/meta-model.js';
import { processPage } from '../api/.test-build/demo/source-processing.js';
import { normalizeBatch } from '../api/.test-build/demo/normalization.js';
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');
const out = new URL('../artifacts/pipeline-verification/', import.meta.url);
await mkdir(out, { recursive: true });
const config = loadConfig();
if (!config.model) throw new Error('Set META_MODEL_API_KEY in api/.env first.');
const model = new MetaModelClient(config.model);
const input = await readFile(
  new URL('../artifacts/spark-vision/redacted-page.png', import.meta.url),
);
const batchId = randomUUID(),
  documents = [],
  metrics = { pages: [], normalizationMs: null, normalization: null };
const normalizationOnly = process.argv.includes('--normalization-only');
for (const angle of normalizationOnly ? [] : [0, 90, 180]) {
  // Test input rotations, never runtime orientation detection/retry.
  const image = await sharp(input).rotate(angle).png().toBuffer();
  const documentId = randomUUID(),
    started = performance.now();
  try {
    const result = await processPage(
      {
        batchId,
        documentId,
        pageId: `${documentId}:0`,
        page: 0,
        revision: randomUUID(),
        image: `data:image/png;base64,${image.toString('base64')}`,
      },
      model,
    );
    const record = {
      angle,
      elapsedMs: Math.round(performance.now() - started),
      rows: result.rows.length,
      boundedRows: result.observations.filter((o) => o.comparator).length,
      collectionDates: result.observations.filter((o) => o.date).length,
      uncertainRows: result.rows.filter((r) => r.uncertainty.length).length,
    };
    metrics.pages.push(record);
    console.log(JSON.stringify(record));
    await writeFile(new URL(`spark-${angle}.json`, out), JSON.stringify(result, null, 2));
    documents.push({
      id: documentId,
      name: 'Lab document',
      observations: result.observations,
      review: null,
    });
  } catch {
    metrics.pages.push({
      angle,
      error: 'Transcription failed',
      elapsedMs: Math.round(performance.now() - started),
    });
    console.log('Transcription failed; no provider content logged.');
  }
  await writeFile(new URL('model-timings.json', out), JSON.stringify(metrics, null, 2));
}
if (normalizationOnly) {
  const id = randomUUID();
  const cases = [
    ['Glukose', '90', 'mg/dL', 'Serum'],
    ['Glucose', '5', 'mmol/L', 'serum'],
    ['Glukoza', '92', 'mg/dL', 'surowica'],
    ['Glucose', '5', 'mmol/L', 'urine'],
    ['Monocytes', '0.4', '10^9/L', null],
    ['Monocytes', '4', '%', null],
    ['Free T4', '15', 'pmol/L', null],
    ['Total T4', '100', 'nmol/L', null],
    ['CRP', '<0.6', 'mg/L', null],
    ['CRP', '0.6', null, null],
  ];
  const observations = cases.map(([name, valueText, unit, specimen], i) => ({
    id: `${id}:0:${i}`,
    documentId: id,
    page: 0,
    words: [],
    bbox: null,
    name,
    valueText,
    value: Number(valueText.replace('<', '')),
    comparator: valueText.startsWith('<') ? '<' : null,
    unit,
    date: '2026-10-15',
    dateSource: 'label',
    refText: null,
    refLow: null,
    refHigh: null,
    flag: null,
    transcription: { specimen, method: null, uncertainty: [] },
  }));
  const before = JSON.stringify(observations),
    started = performance.now();
  const result = await normalizeBatch(
    [{ id, name: 'Synthetic', observations, review: null }],
    model,
  );
  const series = result.domains.flatMap((d) => d.charts.flatMap((c) => c.series));
  const summary = {
    elapsedMs: Math.round(performance.now() - started),
    observations: observations.length,
    unchangedMeasurements: JSON.stringify(observations) === before,
    series: series.length,
    warnings: result.warnings.length,
    equivalentMultilingualPoints: series
      .filter((s) => s.key.startsWith('glucose:'))
      .map((s) => s.points.length)
      .sort(),
    countAndPercentageSeparate:
      series.some((s) => s.key.startsWith('mono:')) &&
      series.some((s) => s.key.startsWith('mono-pct:')),
    boundedPoints: series.flatMap((s) => s.points).filter((p) => p.comparator === '<').length,
    missingUnitUnresolved: result.warnings.some(
      (w) => w.reason === 'unit' && w.printedUnit === null,
    ),
  };
  await writeFile(new URL('synthetic-normalization.json', out), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
}
if (documents.length === 3) {
  const started = performance.now();
  try {
    const records = await normalizeBatch(documents, model);
    metrics.normalizationMs = Math.round(performance.now() - started);
    metrics.normalization = {
      series: records.domains.flatMap((d) => d.charts.flatMap((c) => c.series)).length,
      warnings: records.warnings.length,
      values: records.stats.values,
    };
    await writeFile(new URL('normalized.json', out), JSON.stringify(records, null, 2));
  } catch {
    metrics.normalization = { error: 'Normalization failed' };
    metrics.normalizationMs = Math.round(performance.now() - started);
  }
  await writeFile(new URL('model-timings.json', out), JSON.stringify(metrics, null, 2));
  console.log(
    JSON.stringify({ normalizationMs: metrics.normalizationMs, ...metrics.normalization }),
  );
}

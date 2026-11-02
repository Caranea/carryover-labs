// Live check of the Meta model steps against a committed, fully fictional page with a
// hand-checked ground truth. Makes paid calls: up to 3 Muse Spark pages + 1 Muse Wonder batch.
//
//   npm --prefix api ci && npm --prefix api run build
//   node scripts/check-pipeline-models.mjs            # upright, 90° and 180°
//   node scripts/check-pipeline-models.mjs --upright  # one Spark call only
//
// Needs META_MODEL_API_KEY in api/.env. Writes raw answers to artifacts/pipeline-verification/
// (gitignored) and prints a Markdown table for docs/evaluation.md.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { score } from './eval-compare.mjs';

const api = (path) => import(new URL(`../api/dist/${path}`, import.meta.url).href);
const { loadConfig } = await api('config.js').catch(() => {
  throw new Error('Build the API first: npm --prefix api run build');
});
const { MetaModelClient } = await api('records/meta-model.js');
const { processPage } = await api('batches/source-processing.js');
const { normalizeBatch } = await api('batches/normalization.js');
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');

const config = loadConfig();
if (!config.model) throw new Error('Set META_MODEL_API_KEY in api/.env first.');
const model = new MetaModelClient(config.model);

const truth = JSON.parse(
  await readFile(new URL('./fixtures/jane-doe-002.truth.json', import.meta.url), 'utf8'),
);
const input = await readFile(new URL(`../${truth.image}`, import.meta.url));
const out = new URL('../artifacts/pipeline-verification/', import.meta.url);
await mkdir(out, { recursive: true });

const batchId = randomUUID();
const angles = process.argv.includes('--upright') ? [0] : [0, 90, 180];
const results = [];
const documents = [];
for (const angle of angles) {
  // Rotations test the model on sideways photos; the app itself never rotates pages.
  const image = await sharp(input).rotate(angle).jpeg({ quality: 90 }).toBuffer();
  const documentId = randomUUID();
  const started = performance.now();
  try {
    const page = await processPage(
      {
        batchId,
        documentId,
        pageId: `${documentId}:0`,
        page: 0,
        revision: randomUUID(),
        image: `data:image/jpeg;base64,${image.toString('base64')}`,
      },
      model,
    );
    const seconds = (performance.now() - started) / 1000;
    results.push({ angle, seconds, ...score(truth.rows, page.rows) });
    await writeFile(new URL(`spark-${angle}.json`, out), JSON.stringify(page, null, 2));
    documents.push({
      id: documentId,
      name: 'Lab document',
      observations: page.observations,
      dates: page.dates,
    });
  } catch (error) {
    // Our own words only: provider text can echo submitted content.
    results.push({ angle, error: error instanceof Error ? error.name : 'Error' });
  }
}

let normalization = null;
if (documents.length) {
  const started = performance.now();
  try {
    const records = await normalizeBatch([documents[0]], model);
    const series = records.domains.flatMap((d) => d.charts.flatMap((c) => c.series));
    const reasons = {};
    for (const w of records.warnings) reasons[w.reason] = (reasons[w.reason] ?? 0) + 1;
    normalization = {
      seconds: (performance.now() - started) / 1000,
      charted: records.stats.values,
      series: series.length,
      held: records.warnings.length,
      reasons,
    };
    await writeFile(new URL('normalized.json', out), JSON.stringify(records, null, 2));
  } catch (error) {
    normalization = { error: error instanceof Error ? error.name : 'Error' };
  }
}

await writeFile(
  new URL('summary.json', out),
  JSON.stringify({ measuredAt: new Date().toISOString(), results, normalization }, null, 2),
);

const n = truth.rows.length;
const lines = [
  `Muse Spark on ${truth.image} (${n} rows in the ground truth)`,
  '',
  '| Rotation | Round trip | Rows found | Values correct | Units correct | Marked doubtful | Extra rows |',
  '| -------- | ---------: | ---------: | -------------: | ------------: | --------------: | ---------: |',
  ...results.map((r) =>
    r.error
      ? `| ${r.angle}° | failed (${r.error}) | | | | | |`
      : `| ${r.angle}° | ${r.seconds.toFixed(1)} s | ${r.namesFound}/${n} | ${r.valuesCorrect}/${n} | ${r.unitsCorrect}/${n} | ${r.markedDoubtful} | ${r.extraRows} |`,
  ),
];
for (const r of results.filter((r) => r.wrongValues?.length || r.missing?.length))
  lines.push(
    '',
    `${r.angle}°: wrong values ${JSON.stringify(r.wrongValues)}; missing ${JSON.stringify(r.missing)}`,
  );
if (normalization?.error) lines.push('', `Muse Wonder failed (${normalization.error}).`);
else if (normalization)
  lines.push(
    '',
    `Muse Wonder and server charts (upright page): ${normalization.charted} values charted in ${normalization.series} series, ` +
      `${normalization.held} held for review ${JSON.stringify(normalization.reasons)}, ${normalization.seconds.toFixed(1)} s.`,
  );
console.log(lines.join('\n'));

// Records the sample patient's answers from Meta, once: Muse Spark's transcription of every
// sample page and Muse Wonder's identity of every printed test name on them. The API replays
// them for the "Try the sample patient" button, so judges and visitors get real Meta answers
// with no key and no cost.
//
//   npm --prefix api ci && npm --prefix api run build
//   node scripts/record-samples.mjs            # record what is missing (all of it, the first time)
//   node scripts/record-samples.mjs --refresh  # record everything again
//
// Needs META_MODEL_API_KEY in api/.env. Makes paid calls: about 24 Spark pages and a few
// Wonder calls, roughly $1-2 in all. Writes api/samples/recorded.json; commit it.
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createRequire } from 'node:module';

const api = (path) => import(new URL(`../api/dist/${path}`, import.meta.url).href);
const { loadConfig } = await api('config.js').catch(() => {
  throw new Error('Build the API first: npm --prefix api run build');
});
const { MetaModelClient } = await api('records/meta-model.js');
const { cost } = await api('jobs/daily-spend.js');
const { extractionTask, processPage, SPARK_MODEL } = await api('batches/source-processing.js');
const { normalizeBatch, WONDER_MODEL } = await api('batches/normalization.js');
const { SampleAnswers } = await api('batches/samples.js');
// The same documents the /demo page shows (Node strips the TypeScript types).
const { DEMO_DOCUMENTS } = await import('../src/app/core/demo-documents.ts');
const sharp = createRequire(new URL('../api/package.json', import.meta.url))('sharp');

const config = loadConfig();
if (!config.model) throw new Error('Set META_MODEL_API_KEY in api/.env first.');
let spent = 0;
const model = new MetaModelClient(config.model, undefined, (task, usage) => {
  if (usage) spent += cost(task.model, usage);
});

const file = config.samplesFile;
const refresh = process.argv.includes('--refresh');
const previous =
  !refresh && existsSync(file)
    ? JSON.parse(await readFile(file, 'utf8'))
    : { pages: {}, identities: {}, specimens: {} };

/** The page as the browser starts from it, encoded as the server would receive it. */
async function pageImage(src) {
  const bytes = await readFile(new URL(`../public/${src}`, import.meta.url));
  const png = await sharp(bytes).flatten({ background: '#fff' }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
}

/** A model that keeps Spark's raw answer for the recording. */
const recording = (sample, pages) => ({
  name: model.name,
  ask: async (task, signal) => {
    const answer = await model.ask(task, signal);
    pages[sample] = answer;
    return answer;
  },
});

const pages = { ...previous.pages };
const work = DEMO_DOCUMENTS.flatMap((doc) =>
  doc.pages.map((page, index) => ({ doc, page, index, sample: `${doc.id}:${index}` })),
);
const todo = work.filter((w) => !pages[w.sample]);
console.log(`${work.length} sample pages, ${todo.length} to record with ${SPARK_MODEL}.`);
const failed = [];
for (let i = 0; i < todo.length; i += 4)
  await Promise.all(
    todo.slice(i, i + 4).map(async ({ page, index, sample, doc }) => {
      const started = performance.now();
      try {
        const answer = await recording(sample, pages).ask(
          extractionTask(await pageImage(page.src)),
        );
        console.log(
          `  ${sample}: ${answer.rows.length} rows in ${((performance.now() - started) / 1000).toFixed(0)} s`,
        );
      } catch (error) {
        failed.push(sample);
        console.log(`  ${sample} (${doc.name} page ${index + 1}) failed: ${error.message}`);
      }
    }),
  );
if (failed.length) throw new Error(`Run again to retry ${failed.join(', ')}.`);

// Replay every page through the server code, then identify all names in one batch, so any
// selection of sample documents finds every one of its test names recorded.
const answers = new SampleAnswers({ ...previous, pages });
const documents = [];
for (const doc of DEMO_DOCUMENTS) {
  const observations = [];
  const dates = [];
  for (const [index, page] of doc.pages.entries()) {
    const sample = `${doc.id}:${index}`;
    const result = await processPage(
      {
        batchId: 'record',
        documentId: doc.id,
        pageId: `${doc.id}:${index}`,
        page: index,
        revision: 'recorded',
        image: await pageImage(page.src),
        sample,
      },
      answers.page(sample),
    );
    observations.push(...result.observations);
    dates.push(...result.dates);
  }
  documents.push({ id: doc.id, name: doc.name, observations, dates });
}
const learned = { identities: {}, specimens: {} };
const records = await normalizeBatch(documents, model, undefined, {
  cache: refresh ? undefined : answers,
  learned,
});

const result = {
  recordedAt: new Date().toISOString(),
  models: { transcription: SPARK_MODEL, identification: WONDER_MODEL },
  note:
    'Real answers from the Meta Model API for the fictional sample patient, recorded by ' +
    'scripts/record-samples.mjs and replayed by the API at no cost.',
  pages: Object.fromEntries(Object.entries(pages).sort(([a], [b]) => a.localeCompare(b))),
  identities: Object.fromEntries(
    Object.entries({ ...(refresh ? {} : previous.identities), ...learned.identities }).sort(
      ([a], [b]) => a.localeCompare(b),
    ),
  ),
  specimens: { ...(refresh ? {} : previous.specimens), ...learned.specimens },
};
await mkdir(dirname(file), { recursive: true });
await writeFile(file, JSON.stringify(result, null, 1) + '\n');
console.log(
  `Wrote ${file}: ${Object.keys(result.pages).length} pages, ` +
    `${Object.keys(result.identities).length} test names; ${records.stats.values} values chart. ` +
    `Spent about $${spent.toFixed(2)}.`,
);

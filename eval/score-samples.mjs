// Scores Meta's recorded answers for the sample patient against the hand-checked rows of her ten
// documents, end to end: what Muse Spark read, which test Muse Wonder named, and the value and
// date that land in the chart. No key, no network, no cost; the answers are the committed ones.
//
//   npm --prefix api ci && npm --prefix api run build
//   node eval/score-samples.mjs            # summary table for docs/evaluation.md
//   node eval/score-samples.mjs --rows     # also every row that differs
//
// Truth: the 289 rows in src/app/core/demo-data.ts, transcribed by hand and checked against the
// page images, each with its test (in its id) and the chart the server builds from them.
// Answers: api/samples/recorded.json (scripts/record-samples.mjs). Writes the full comparison to
// artifacts/evaluation/samples.json (gitignored).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sameName, sameUnit, sameValue } from './compare.mjs';

const root = new URL('../', import.meta.url);
const require = createRequire(new URL('api/package.json', root));
const sharp = require('sharp');
// Counts only from here on: the normalization log line would interleave with the table.
require('@nestjs/common').Logger.overrideLogger(false);
const api = (path) => import(new URL(`api/dist/${path}`, root).href);
const { processPage } = await api('batches/source-processing.js').catch(() => {
  throw new Error('Build the API first: npm --prefix api run build');
});
const { normalizeBatch } = await api('batches/normalization.js');
const { SampleAnswers } = await api('batches/samples.js');
const { conversionFactor, parseUnit } = await api('records/units.js');
const { CATALOGUE } = await api('shared/catalogue.js');
const { DEMO_DOCUMENTS } = await import(new URL('src/app/core/demo-documents.ts', root).href);

const recording = JSON.parse(await readFile(new URL('api/samples/recorded.json', root), 'utf8'));
const answers = new SampleAnswers(recording);

// The truth rows and the charted points are one JSON object per line in demo-data.ts.
const demo = await readFile(new URL('src/app/core/demo-data.ts', root), 'utf8');
const records = demo.indexOf('export const DEMO_RECORDS');
const truth = demo
  .slice(0, records)
  .split('\n')
  .filter((line) => line.trim().startsWith('{"id"'))
  .map((line) => JSON.parse(line.trim().replace(/,$/, '')));
// Each charted point, with the unit of the line it sits on (the series header before it).
const charted = new Map();
const labels = new Map();
let line = null;
for (const m of demo
  .slice(records)
  .matchAll(
    /\{ key: "([^"]*)", label: "([^"]*)", unit: "([^"]*)"|(\{"observationId":.*?"alsoIn":\[[^\]]*\]\})/g,
  )) {
  if (m[4] === undefined) {
    line = { key: m[1], label: m[2], unit: m[3] };
    labels.set(m[1].split(':')[0], m[2]);
  } else {
    const point = JSON.parse(m[4]);
    charted.set(point.observationId, { ...point, unit: line.unit });
  }
}
/** The same test: the same catalogue key, or for a test outside the catalogue, the same name. */
const sameTest = (expected, series) =>
  series.key.split(':')[0] === expected ||
  labels.get(expected)?.toLowerCase() === series.label.toLowerCase();
const section = (name) => {
  const start = demo.indexOf(`  ${name}: [`, records);
  return demo.slice(start, demo.indexOf('\n  ],', start));
};
const truthHeld = new Map(
  [...section('warnings').matchAll(/\{"observationId":"([^"]+)".*?"reason":"([^"]+)"/g)].map(
    (m) => [m[1], m[2]],
  ),
);
const truthText = new Set(
  [...section('textResults').matchAll(/\{"observationId":"([^"]+)"/g)].map((m) => m[1]),
);
/** "jane-doe-039:0:hgb:2012-06-08": the test is the third part. */
const testOf = (id) => id.split(':')[2];

// 1. Replay every recorded page through the server's own code, as the app does.
const documents = [];
const rowsOf = new Map();
for (const doc of DEMO_DOCUMENTS) {
  const observations = [];
  const dates = [];
  for (const [index, page] of doc.pages.entries()) {
    const sample = `${doc.id}:${index}`;
    const blank = await sharp({
      create: { width: page.width, height: page.height, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    const result = await processPage(
      {
        batchId: 'evaluation',
        documentId: doc.id,
        pageId: sample,
        page: index,
        revision: 'recorded',
        image: `data:image/png;base64,${blank.toString('base64')}`,
        sample,
      },
      answers.page(sample),
    );
    observations.push(...result.observations);
    dates.push(...result.dates);
  }
  documents.push({ id: doc.id, name: doc.name, observations, dates });
  rowsOf.set(doc.id, observations);
}
// 2. Name every test from the recorded Muse Wonder answers and build the charts, with no model.
const built = await normalizeBatch(documents, null, undefined, { cache: answers });
const points = new Map();
for (const domain of built.domains)
  for (const chart of domain.charts)
    for (const series of chart.series)
      for (const p of series.points) points.set(p.observationId, { ...p, series });
const held = new Map(built.warnings.map((w) => [w.observationId, w]));
const text = new Map(built.textResults.map((t) => [t.observationId, t]));

// 3. Pair each checked row with the row Spark read at the same place on the same page: the
//    nearest outline, preferring the same printed name. Never by value, which is what is scored.
const centre = (b) => (b ? [b[0] + b[2] / 2, b[1] + b[3] / 2] : null);
const distance = (a, b) => {
  const [p, q] = [centre(a), centre(b)];
  return p && q ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity;
};
const used = new Set();
const pairs = truth.map((t) => {
  const onPage = rowsOf
    .get(t.documentId)
    .filter((o) => o.page === t.page && !used.has(o.id))
    .sort((a, b) => distance(a.bbox, t.bbox) - distance(b.bbox, t.bbox));
  const named = onPage.filter((o) => sameName(o.name, t.name));
  const row = named[0] ?? (distance(onPage[0]?.bbox, t.bbox) < 40 ? onPage[0] : undefined);
  if (row) used.add(row.id);
  return { truth: t, row };
});

/** `value` in `from`, expressed in `to` (null when the units can't be converted). */
function convert(value, from, to, test) {
  // A ratio such as INR prints no unit; the chart calls it "ratio".
  if (from === to || !from || !parseUnit(from)) return value;
  const molarMass = CATALOGUE.find((c) => c.key === test)?.molarMass;
  const [a, b] = [parseUnit(from), parseUnit(to)];
  const factor = a && b ? conversionFactor(a, b, molarMass) : null;
  return factor === null ? null : value * factor;
}

/**
 * The charted value against the checked one, both in the checked chart's unit, so mg/dL against
 * µmol/L still compares. The checked value is the row's own: a test printed twice on one date
 * (analyser and manual smear) shares one id in demo-data.ts.
 */
function sameChartValue(t, expected, got) {
  const test = got.series.key.split(':')[0];
  const want = convert(t.value, t.unit, expected.unit, test);
  const have = convert(got.value, got.series.unit, expected.unit, test);
  if (want === null || have === null) return false;
  return Math.abs(have - want) <= 1e-3 * Math.max(1, Math.abs(want));
}
const sparkRows = [...rowsOf.values()].flat();

const scored = pairs.map(({ truth: t, row }) => {
  const expected = charted.get(t.id);
  const got = row && points.get(row.id);
  const test = testOf(t.id);
  return {
    id: t.id,
    printed: t.name,
    found: !!row,
    sameName: !!row && sameName(row.name, t.name),
    value: !!row && sameValue(row.valueText, t.valueText),
    unit: !!row && sameUnit(row.unit, t.unit),
    doubt: !!row?.transcription?.doubt,
    // Muse Wonder named the same test (catalogue key, before the per-fluid suffix).
    identity: got ? sameTest(test, got.series) : null,
    expectedTest: test,
    gotTest: got?.series.key.split(':')[0] ?? (row && text.get(row.id)?.key) ?? null,
    expectedChart: expected
      ? { value: expected.value, date: expected.date }
      : truthHeld.has(t.id)
        ? 'held'
        : truthText.has(t.id)
          ? 'text'
          : null,
    gotChart: got
      ? { value: got.value, unit: got.series.unit, date: got.date }
      : row && held.has(row.id)
        ? { held: held.get(row.id).reason }
        : row && text.has(row.id)
          ? 'text'
          : null,
    chartValue: !!(expected && got && sameChartValue(t, expected, got)),
    chartDate: !!(expected && got && expected.date === got.date),
  };
});

// Tests printed under more than one name or in more than one report: merged into one line?
const byTest = new Map();
for (const s of scored) {
  const t = truth.find((x) => x.id === s.id);
  const entry = byTest.get(s.expectedTest) ?? {
    documents: new Set(),
    names: new Set(),
    lines: new Set(),
  };
  entry.documents.add(t.documentId);
  entry.names.add(t.name.toLowerCase());
  const row = pairs.find((p) => p.truth.id === s.id).row;
  const got = row && points.get(row.id);
  if (got) entry.lines.add(got.series.key);
  byTest.set(s.expectedTest, entry);
}
const across = [...byTest.entries()].filter(([, e]) => e.documents.size > 1);
const merged = across.filter(([, e]) => e.lines.size === 1);
const renamed = across.filter(([, e]) => e.names.size > 1);
const renamedMerged = renamed.filter(([, e]) => e.lines.size === 1);

const n = truth.length;
const count = (f) => scored.filter(f).length;
const expectedCharted = scored.filter((s) => typeof s.expectedChart === 'object');
const pct = (a, b) => `${a}/${b} (${((100 * a) / b).toFixed(1)}%)`;
const summary = {
  measuredAt: new Date().toISOString(),
  recordedAt: recording.recordedAt,
  models: recording.models,
  documents: DEMO_DOCUMENTS.length,
  pages: Object.keys(recording.pages).length,
  truthRows: n,
  sparkRows: sparkRows.length,
  rowsFound: count((s) => s.found),
  namesSame: count((s) => s.sameName),
  extraRows: sparkRows.length - used.size,
  valuesCorrect: count((s) => s.value),
  unitsCorrect: count((s) => s.unit),
  markedDoubtful: count((s) => s.doubt),
  chartedExpected: expectedCharted.length,
  identityCorrect: expectedCharted.filter((s) => s.identity === true).length,
  identityWrong: expectedCharted.filter((s) => s.identity === false).length,
  heldInstead: expectedCharted.filter((s) => s.gotChart?.held).length,
  chartValueCorrect: expectedCharted.filter((s) => s.chartValue).length,
  chartDateCorrect: expectedCharted.filter((s) => s.chartDate).length,
  heldExpected: count((s) => s.expectedChart === 'held'),
  heldAsExpected: count((s) => s.expectedChart === 'held' && s.gotChart?.held),
  textExpected: count((s) => s.expectedChart === 'text'),
  textAsExpected: count((s) => s.expectedChart === 'text' && s.gotChart === 'text'),
  testsAcrossReports: across.length,
  testsMerged: merged.length,
  testsRenamed: renamed.length,
  testsRenamedMerged: renamedMerged.length,
  pipelineCharted: built.stats.values,
  pipelineHeld: built.warnings.length,
};

const out = new URL('artifacts/evaluation/', root);
await mkdir(out, { recursive: true });
await writeFile(new URL('samples.json', out), JSON.stringify({ summary, rows: scored }, null, 2));

const s = summary;
console.log(
  [
    `Recorded ${s.recordedAt.slice(0, 10)} (${s.models.transcription}, ${s.models.identification}); ` +
      `${s.documents} documents, ${s.pages} pages, ${n} hand-checked rows.`,
    '',
    '| Step | Measure | Result |',
    '| ---- | ------- | -----: |',
    `| Muse Spark | Rows found | ${pct(s.rowsFound, n)} |`,
    `| Muse Spark | … with the name as checked | ${pct(s.namesSame, n)} |`,
    `| Muse Spark | Values as printed | ${pct(s.valuesCorrect, n)} |`,
    `| Muse Spark | Units as printed | ${pct(s.unitsCorrect, n)} |`,
    `| Muse Spark | Extra rows (not results) | ${s.extraRows} |`,
    `| Muse Spark | Rows it marked hard to read | ${s.markedDoubtful} |`,
    `| Muse Wonder | Charted readings named as the same test | ${pct(s.identityCorrect, s.chartedExpected)} |`,
    `| Muse Wonder | Named as a different test | ${s.identityWrong} |`,
    `| Server | Held for review instead of charted | ${s.heldInstead} |`,
    `| Server | Readings the checked set holds for review, also held | ${pct(s.heldAsExpected, s.heldExpected)} |`,
    `| Server | Results in words, kept as words | ${pct(s.textAsExpected, s.textExpected)} |`,
    `| End to end | Charted value equals the checked value | ${pct(s.chartValueCorrect, s.chartedExpected)} |`,
    `| End to end | Charted on the checked date | ${pct(s.chartDateCorrect, s.chartedExpected)} |`,
    `| End to end | Tests in several reports kept on one line | ${pct(s.testsMerged, s.testsAcrossReports)} |`,
    `| End to end | … of them printed under different names | ${pct(s.testsRenamedMerged, s.testsRenamed)} |`,
  ].join('\n'),
);
if (process.argv.includes('--rows')) {
  const differ = scored.filter(
    (r) =>
      !r.found ||
      !r.value ||
      !r.unit ||
      r.identity === false ||
      (typeof r.expectedChart === 'object' && (!r.chartValue || !r.chartDate)),
  );
  console.log(`\n${differ.length} rows differ:`);
  for (const r of differ) console.log(JSON.stringify(r));
  for (const [test, e] of across.filter(([, e]) => e.lines.size !== 1))
    console.log(`not on one line: ${test} → ${[...e.lines].join(', ') || 'no chart'}`);
}

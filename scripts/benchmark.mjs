import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { createWorker } from 'tesseract.js';
import { cases, fixtureLines } from '../fixtures/synthetic-labs/cases.mjs';
import { extractDocument } from '../api/dist/results/extract.js';
import { normaliseName } from '../api/dist/records/match.js';
import { parseNumber } from '../api/dist/results/tokens.js';
import { buildRecords } from '../api/dist/records/build.js';
import { matchTest } from '../api/dist/records/match.js';
import { conversionFactor, parseUnit } from '../api/dist/records/units.js';

const apiRequire = createRequire(new URL('../api/package.json', import.meta.url));
const sharp = apiRequire('sharp');
const root = resolve(import.meta.dirname, '..');
const out = join(root, 'artifacts', 'benchmark');
await mkdir(out, { recursive: true });
const adapter = join(out, 'adapter.mjs');
await build({ entryPoints: [join(root, 'scripts/benchmark-adapter.ts')], outfile: adapter, bundle: true, format: 'esm', platform: 'node' });
const { applyDetections, NORMAL, pageToWords, boxesToBurn, toStoredPage } = await import(pathToFileURL(adapter).href);
const withOcr = process.argv.includes('--ocr');
const report = { version: 1, syntheticOnly: true, generatedAt: new Date().toISOString(), mode: withOcr ? 'ocr-and-rules' : 'positioned-text-and-rules',
  caveat: 'Synthetic layout benchmark, not clinical accuracy or real-world PII recall. The optional NER model is not included. OCR misses count against page-level privacy coverage.', fixtures: [] };
let worker;
if (withOcr) {
  const langPath = join(out, 'tessdata');
  await mkdir(langPath, { recursive: true });
  for (const lang of ['pol', 'deu', 'eng']) await copyFile(join(root, 'node_modules/@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`), join(langPath, `${lang}.traineddata.gz`));
  worker = await createWorker('pol+deu+eng', 1, { langPath, cachePath: langPath, gzip: true, cacheMethod: 'none' });
}
const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const equalReading = (a, b) => normaliseName(a.name) === normaliseName(b.name) && a.value === parseNumber(b.valueText)?.value && a.comparator === (parseNumber(b.valueText)?.comparator ?? null) && a.unit === b.unit && a.date === b.date;
try {
  for (const fixture of cases) {
    const tokens = [], overlays = [];
    let id = 0;
    const lines = fixtureLines(fixture);
    for (let line = 0; line < lines.length; line++) for (const cell of lines[line]) {
      let x = cell.x;
      for (const text of cell.text.split(/\s+/).filter(Boolean)) {
        const { data, info } = await sharp({ text: { text: text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'), font: 'Arial 28', rgba: true, dpi: 72 } }).png().toBuffer({ resolveWithObject: true });
        const y = 70 + line * 75;
        tokens.push({ id: id++, text, box: { x, y, w: info.width, h: info.height }, line, hidden: false, pii: !!cell.pii });
        if (x + info.width < 1600) overlays.push({ input: data, left: x, top: y });
        x += info.width + 10;
      }
    }
    const image = await sharp({ create: { width: 1600, height: 1000, channels: 3, background: '#ffffff' } }).composite(overlays).png().toBuffer();
    await writeFile(join(out, `${fixture.id}.png`), image);
    const variants = withOcr ? ['clean', 'small-photo'] : ['positioned-text'];
    for (const variant of variants) {
      const started = performance.now();
      const scale = variant === 'small-photo' ? 0.6 : 1;
      const input = scale === 1 ? image : await sharp(image).resize(960, 600).jpeg({ quality: 65 }).toBuffer();
      if (variant === 'small-photo') await writeFile(join(out, `${fixture.id}-small.jpg`), input);
      const ocr = worker ? (await worker.recognize(input, {}, { blocks: true, text: true })).data : null;
      const words = ocr ? pageToWords(ocr, 0) : tokens.map(({ pii, ...w }) => w);
      const page = { index: 0, width: Math.round(1600 * scale), height: Math.round(1000 * scale), image: new Blob([input]), imageUrl: null, words, regions: [], ocr: !!ocr };
      const protectedPage = applyDetections([page], [null], NORMAL)[0];
      const stored = toStoredPage(protectedPage);
      const doc = { id: fixture.id, name: 'Fictional benchmark', sourceKind: 'image', pages: [stored], pageCount: 1, hiddenCount: stored.words.filter(w => w.h).length, createdAt: '', updatedAt: '' };
      const results = extractDocument(doc).observations;
      const record = buildRecords([{ id: doc.id, name: doc.name, observations: results, review: null }], { version: 1, names: {}, tests: [], conversions: {} }, false).records;
      const chartRows = record.domains.flatMap(d => d.charts.flatMap(c => c.series.flatMap(s => s.points.map(p => ({ ...p, key: s.key, seriesUnit: s.unit })))));
      const availableExpected = [...fixture.rows];
      const wrongChartRows = chartRows.filter(point => {
        const found = availableExpected.findIndex(expected => {
          const test = matchTest(expected.name, expected.unit)?.test;
          const parsed = parseNumber(expected.valueText), from = parseUnit(expected.unit), to = parseUnit(point.seriesUnit);
          const factor = test && from && to ? conversionFactor(from, to, test.molarMass) : null;
          return test?.key === point.key && parsed && factor !== null && Math.abs(parsed.value * factor - point.value) < 1e-8 && parsed.comparator === point.comparator && expected.date === point.date;
        });
        if (found < 0) return true;
        availableExpected.splice(found, 1); return false;
      });
      const remaining = [...results];
      const missing = fixture.rows.filter(expected => {
        const found = remaining.findIndex(actual => equalReading(actual, expected));
        if (found < 0) return true;
        remaining.splice(found, 1); return false;
      });
      const masks = boxesToBurn(protectedPage);
      const pii = tokens.filter(t => t.pii).map(t => ({ x: t.box.x * scale, y: t.box.y * scale, w: t.box.w * scale, h: t.box.h * scale }));
      const covered = pii.filter(box => masks.some(mask => overlap(box, mask) / (box.w * box.h) >= 0.9)).length;
      const totalExpected = fixture.rows.length, exact = totalExpected - missing.length;
      report.fixtures.push({ id: fixture.id, language: fixture.language, variant, expected: totalExpected, extracted: results.length, exact, missing: missing.map(r => r.name), unexpectedOrMismatched: remaining.map(r => ({ name: r.name, valueText: r.valueText, unit: r.unit, date: r.date })), plotted: chartRows.length, wrongPlotted: wrongChartRows.length, heldForReview: record.warnings.length, piiWords: pii.length, piiCovered: covered, milliseconds: Math.round(performance.now() - started), imageSha256: createHash('sha256').update(input).digest('hex') });
      await writeFile(join(out, `${fixture.id}-${variant}-visible.json`), JSON.stringify(stored, null, 2));
      console.log(`${fixture.id}/${variant}: ${exact}/${totalExpected} exact rows; ${covered}/${pii.length} personal-word boxes covered`);
    }
  }
} finally { await worker?.terminate(); }
const totals = report.fixtures.reduce((t, f) => ({ expected: t.expected + f.expected, extracted: t.extracted + f.extracted, exact: t.exact + f.exact, piiWords: t.piiWords + f.piiWords, piiCovered: t.piiCovered + f.piiCovered }), { expected: 0, extracted: 0, exact: 0, piiWords: 0, piiCovered: 0 });
report.totals = { ...totals, exactRowRecall: totals.exact / totals.expected, exactRowPrecision: totals.exact / Math.max(1, totals.extracted), piiBoxRecall: totals.piiCovered / totals.piiWords,
  plotted: report.fixtures.reduce((n, f) => n + f.plotted, 0), wrongPlotted: report.fixtures.reduce((n, f) => n + f.wrongPlotted, 0), heldForReview: report.fixtures.reduce((n, f) => n + f.heldForReview, 0) };
await writeFile(join(out, withOcr ? 'report-ocr.json' : 'report-text.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.totals));
// Safety anchors, separate from measured recall: never normalise an extreme number or merge bounded repeats.
const baseline = report.fixtures.filter(f => f.variant === 'positioned-text');
if (baseline.some(f => ['source-decimal-trap', 'same-day-limits', 'ambiguous-date'].includes(f.id) && f.exact !== f.expected)) process.exitCode = 1;
if (report.totals.wrongPlotted > 0) process.exitCode = 1;

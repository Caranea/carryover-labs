import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import sharp from 'sharp';
import { parsePageRequest, processPage } from './source-processing.js';
import { normalizeBatch } from './normalization.js';
import type { PageDate, PageRequest, PrintedRow } from '../shared/processing.js';
import { AnswerCutOff, type JsonModel, type ModelTask } from '../records/meta-model.js';
import type { SourceDocument } from './normalization.js';

export const printedRow = (patch: Partial<PrintedRow> = {}): PrintedRow => ({
  name: 'CRP',
  value: '<0,6',
  unit: 'mg/L',
  reference: '0-5',
  flag: 'L',
  marker: null,
  section: null,
  specimen: null,
  date: { kind: 'collected', printed: '15.10.2026', iso: '2026-10-15' },
  region: [0.1, 0.2, 0.5, 0.1],
  doubt: null,
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
async function docs(rows: PrintedRow[], dates: PageDate[] = []): Promise<SourceDocument[]> {
  const result = await processPage(
    await pageRequest(),
    model({ rows, dates, suggestedName: 'Lab results' }),
  );
  return [
    { id: result.documentId, name: 'Lab document', observations: result.observations, dates },
  ];
}
type Reply = {
  key?: string | null;
  newTest?: Record<string, string> | null;
  panel?: string;
  reason?: string;
  words?: { printed: string; english: string; level: number | null }[];
};
interface Asked {
  tests: {
    ref: string;
    name: string;
    units: string[];
    specimens: string[];
    sections: string[];
    words: string[];
  }[];
  specimens: string[];
}
const asked = (task: ModelTask) => JSON.parse(task.user) as Asked;
/** A stub Wonder that answers each question by its printed name ("Name %" for percentages). */
function wonder(replies: Record<string, Reply>, tasks: ModelTask[] = []): JsonModel {
  return {
    name: 'Synthetic Wonder',
    async ask<T>(task: ModelTask) {
      tasks.push(task);
      const { tests, specimens } = asked(task);
      const english: Record<string, string> = { Surowica: 'serum', Mocz: 'urine' };
      return {
        tests: tests.map((q) => {
          const percent = q.units.some((u) => u.includes('%'));
          const reply = replies[percent ? `${q.name} %` : q.name] ?? {};
          return {
            ref: q.ref,
            key: reply.key ?? null,
            newTest: reply.newTest ?? null,
            panel: reply.panel ?? 'other',
            reason: reply.reason ?? '',
            words: reply.words ?? [],
          };
        }),
        specimens: specimens.map((printed) => ({ printed, english: english[printed] ?? printed })),
      } as T;
    },
  };
}
const seriesOf = (result: Awaited<ReturnType<typeof normalizeBatch>>) =>
  result.domains.flatMap((d) => d.charts.flatMap((c) => c.series));

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
              doubt: 'Unreadable row',
            }),
          ],
          dates: [],
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
    assert.deepEqual(o.transcription?.date, printedRow().date);
    assert.equal(o.sourceImage?.pageId, 'doc-test:0');
    assert.equal(result.observations[1].value, null);
  });
  it('dates a row by its own collection date only; other dates wait for the whole document', async () => {
    const result = await docs([
      printedRow({ date: { kind: 'reported', printed: '16.10.2026', iso: '2026-10-16' } }),
    ]);
    assert.equal(result[0].observations[0].date, null);
  });
  it('rejects invalid source geometry and dates instead of repairing guessed fields', async () => {
    for (const row of [
      printedRow({ region: [0.9, 0, 0.9, 0.1] }),
      printedRow({ date: { kind: 'collected', printed: '45.13.2026', iso: '2026-13-45' } }),
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

describe('Wonder test identities and verified unit arithmetic', () => {
  it('preserves comparisons, original references and separate exact/bounded points', async () => {
    const source = await docs([printedRow(), printedRow({ value: '0.6' })]);
    const before = JSON.stringify(source[0].observations),
      tasks: ModelTask[] = [];
    const result = await normalizeBatch(source, wonder({ CRP: { key: 'crp' } }, tasks));
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].model, 'muse-wonder-1.0');
    assert.equal(tasks[0].image, undefined);
    assert.equal(JSON.stringify(source[0].observations), before);
    const points = seriesOf(result).flatMap((s) => s.points);
    assert.deepEqual(
      points.map((p) => p.comparator),
      ['<', null],
    );
    assert.equal(points[0].printedReference, '0-5');
    assert.equal(points[0].documentId, 'doc-test');
  });

  it('asks once per printed name, keeps counts, percentages, free/total and body fluids apart, and nothing else', async () => {
    const source = await docs([
      printedRow({ name: 'Glukoza', value: '90', unit: 'mg/dL', specimen: 'Surowica' }),
      printedRow({ name: 'GLUKOZA ', value: '5', unit: 'mmol/L', specimen: 'Surowica' }),
      printedRow({ name: 'Glukoza', value: '5', unit: 'mmol/L', specimen: 'Mocz' }),
      printedRow({ name: 'Glukoza', value: '88', unit: 'mg/dL', specimen: 'Osocze (fluorek)' }),
      printedRow({ name: 'Monocyty', value: '0.4', unit: '10^9/L' }),
      printedRow({ name: 'Monocyty', value: '4', unit: '%' }),
      printedRow({ name: 'Free T4', value: '15', unit: 'pmol/L' }),
      printedRow({ name: 'Total T4', value: '100', unit: 'nmol/L' }),
    ]);
    const tasks: ModelTask[] = [];
    const result = await normalizeBatch(
      source,
      wonder(
        {
          Glukoza: { key: 'glucose', panel: 'metabolic' },
          Monocyty: { key: 'mono' },
          'Monocyty %': { key: 'mono-pct' },
          'Free T4': { key: 'ft4' },
          'Total T4': { key: 'ft4' },
        },
        tasks,
      ),
    );
    const { tests, specimens } = asked(tasks[0]);
    // Blood glucose, whatever the tube, is one question; urine glucose is another.
    assert.equal(tests.length, 6);
    assert.deepEqual(
      tests.filter((q) => q.name === 'Glukoza').map((q) => [q.units, q.specimens]),
      [
        [
          ['mg/dL', 'mmol/L'],
          ['Surowica', 'Osocze (fluorek)'],
        ],
        [['mmol/L'], ['Mocz']],
      ],
    );
    assert.deepEqual(specimens, ['Surowica', 'Osocze (fluorek)', 'Mocz']);
    const series = seriesOf(result);
    // Serum and plasma share one blood line; urine gets its own line, in the urine panel.
    assert.equal(series.find((s) => s.label === 'Glucose')?.points.length, 3);
    assert.equal(
      series.find((s) => s.label === 'Glucose · urine'),
      undefined,
    );
    const urine = result.domains.find((d) => d.key === 'urine');
    assert.equal(urine?.charts[0].series[0].label, 'Glucose');
    assert.equal(result.domains.find((d) => d.key === 'metabolic')?.charts.length, 1);
    assert.ok(series.some((s) => s.key.startsWith('mono:')));
    assert.ok(series.some((s) => s.key.startsWith('mono-pct:')));
    // "Total T4" named as the free test is sent back to the user, not charted.
    assert.ok(result.warnings.some((w) => w.printedName === 'Total T4'));
    assert.equal(source[0].observations.length, 8);
  });

  it('places undated rows by the dates printed elsewhere in the document', async () => {
    const undated = { date: null };
    const source = await docs(
      [
        printedRow({ ...undated, name: 'CRP' }),
        printedRow({ ...undated, name: 'anty-TPO', marker: '5', unit: 'IU/ml', value: '3,4' }),
      ],
      [
        // "Data pobrania: --" is not a date; the report prints when the sample arrived.
        { kind: 'received', printed: '2014-02-09 19:13', iso: '2014-02-09', marker: null },
        { kind: 'reported', printed: '2014-02-11', iso: '2014-02-11', marker: null },
        { kind: 'performed', printed: '2023-11-13', iso: '2023-11-13', marker: '5' },
      ],
    );
    const result = await normalizeBatch(
      source,
      wonder({ CRP: { key: 'crp', panel: 'inflammation' }, 'anty-TPO': { key: 'anti-tpo' } }),
    );
    const points = seriesOf(result).flatMap((s) => s.points);
    assert.deepEqual(points.map((p) => [p.printedName, p.date, p.dateKind]).sort(), [
      ['CRP', '2014-02-09', 'received'],
      ['anty-TPO', '2023-11-13', 'performed'],
    ]);
  });

  it('reads an ambiguous 01/06/2012 the way the other dates settle it, and keeps urine units', async () => {
    const [first] = await docs([
      printedRow({ date: { kind: 'collected', printed: '21/05/2012', iso: '2012-05-21' } }),
    ]);
    const [second] = await docs(
      [
        printedRow({ date: null }),
        printedRow({ name: 'Leukocyty', value: '7', unit: 'wpw', specimen: 'Mocz', date: null }),
      ],
      [{ kind: 'collected', printed: '01/06/2012', iso: null, marker: null }],
    );
    const result = await normalizeBatch(
      [first, { ...second, id: 'other-doc' }],
      wonder({ CRP: { key: 'crp' }, Leukocyty: { key: 'wbc', panel: 'urine' } }),
    );
    assert.deepEqual(
      seriesOf(result)
        .flatMap((s) => s.points.map((p) => `${s.label} ${p.date} ${p.printedUnit}`))
        .sort(),
      ['CRP 2012-05-21 mg/L', 'CRP 2012-06-01 mg/L', 'White blood cells 2012-06-01 wpw'],
    );
  });

  it('leaves a row undated when the document prints two different dates of the best kind', async () => {
    const source = await docs(
      [printedRow({ date: null })],
      [
        { kind: 'collected', printed: '2014-02-09', iso: '2014-02-09', marker: null },
        { kind: 'collected', printed: '2014-03-01', iso: '2014-03-01', marker: null },
        { kind: 'reported', printed: '2014-03-02', iso: '2014-03-02', marker: null },
      ],
    );
    const result = await normalizeBatch(source, wonder({ CRP: { key: 'crp' } }));
    assert.equal(result.warnings[0].reason, 'no-date');
  });

  it('asks separately about a name used in a blood and in a urine section', async () => {
    const source = await docs([
      printedRow({ name: 'Leukocyty', value: '5,3', unit: 'tys/µl', section: 'Morfologia krwi' }),
      printedRow({ name: 'Leukocyty', value: 'wykryto', unit: null, section: 'Osad moczu' }),
      printedRow({ name: 'Leukocyty', value: '7', unit: 'wpw', section: 'Osad moczu' }),
    ]);
    const tasks: ModelTask[] = [];
    const result = await normalizeBatch(source, wonder({ Leukocyty: { key: 'wbc' } }, tasks));
    assert.deepEqual(
      asked(tasks[0]).tests.map((q) => q.sections),
      [['Morfologia krwi'], ['Osad moczu']],
    );
    assert.deepEqual(
      result.domains.map((d) => [d.key, d.charts[0].series[0].unit]),
      [
        ['urine', 'wpw'],
        ['other', '10^9/L'],
      ],
    );
  });

  it('translates results printed in words and keeps them in their panel', async () => {
    const source = await docs([
      printedRow({ name: 'Nabłonki płaskie', value: 'pojedyncze', unit: null, specimen: 'Mocz' }),
      printedRow({
        name: 'Nabłonki płaskie',
        value: 'Bardzo liczne',
        unit: null,
        specimen: 'Mocz',
      }),
    ]);
    const tasks: ModelTask[] = [];
    const result = await normalizeBatch(
      source,
      wonder(
        {
          'Nabłonki płaskie': {
            newTest: { key: 'squamous-epithelial', label: 'Squamous epithelial cells', unit: '' },
            panel: 'urine',
            words: [
              { printed: 'pojedyncze', english: 'occasional', level: 1 },
              { printed: 'bardzo liczne', english: 'very numerous', level: 4 },
            ],
          },
        },
        tasks,
      ),
    );
    assert.deepEqual(asked(tasks[0]).tests[0].words, ['pojedyncze', 'Bardzo liczne']);
    assert.deepEqual(
      result.textResults.map((t) => [t.domain, t.label, t.english, t.level]),
      [
        ['urine', 'Squamous epithelial cells', 'occasional', 1],
        ['urine', 'Squamous epithelial cells', 'very numerous', 4],
      ],
    );
  });

  it('keeps ambiguous identities and missing/incompatible/unsupported units visible', async () => {
    const source = await docs([
      printedRow({ unit: null }),
      printedRow({ unit: 'seconds' }),
      printedRow({ unit: 'unknown-unit' }),
      printedRow({ name: 'Ambiguous' }),
    ]);
    const result = await normalizeBatch(
      source,
      wonder({ CRP: { key: 'crp' }, Ambiguous: { reason: 'Not a recognisable test.' } }),
    );
    assert.equal(result.stats.values, 0);
    assert.equal(result.warnings.length, 4);
    assert.ok(result.warnings.some((w) => w.detail === 'Not a recognisable test.'));
  });

  it('rejects answers with extra fields or a missing test', async () => {
    const source = await docs([printedRow(), printedRow({ name: 'Glukoza', unit: 'mg/dL' })]);
    const replies = { CRP: { key: 'crp' }, Glukoza: { key: 'glucose' } };
    const altered = (change: (answer: { tests: object[] }) => unknown): JsonModel => ({
      name: 'Synthetic Wonder',
      async ask<T>(task: ModelTask) {
        return change(await wonder(replies).ask<{ tests: object[] }>(task)) as T;
      },
    });
    await assert.rejects(
      normalizeBatch(
        source,
        altered((a) => ({ ...a, tests: a.tests.map((t) => ({ ...t, factor: 123 })) })),
      ),
    );
    await assert.rejects(
      normalizeBatch(
        source,
        altered((a) => ({ ...a, tests: a.tests.slice(1) })),
      ),
    );
  });

  it('charts a proposed new test once, and leaves invented units and contradictions unresolved', async () => {
    const source = await docs([
      printedRow({ name: 'Lipoprotein(a)', value: '30', unit: 'mg/dL' }),
      printedRow({ name: 'Lp(a)', value: '35', unit: 'mg/dL' }),
      printedRow({ name: 'Apo B', value: '90', unit: 'mg/dL' }),
      printedRow({ name: 'Odd', value: '1', unit: 'mg/dL' }),
    ]);
    const lpa = { label: 'Lipoprotein(a)', unit: 'mg/dL' };
    const result = await normalizeBatch(
      source,
      wonder({
        // Two keys for one label, as two separate calls might propose: charted as one test.
        'Lipoprotein(a)': { newTest: { ...lpa, key: 'lipoprotein-a' } },
        'Lp(a)': { newTest: { ...lpa, key: 'lp-a' } },
        'Apo B': {
          newTest: { key: 'apo-b', label: 'Apolipoprotein B', unit: 'g/L' },
        },
        Odd: { key: 'crp', newTest: { ...lpa, key: 'odd' } },
      }),
    );
    const series = seriesOf(result);
    assert.equal(series.length, 1);
    assert.equal(series[0].label, 'Lipoprotein(a)');
    assert.equal(series[0].points.length, 2);
    assert.deepEqual(result.warnings.map((w) => w.printedName).sort(), ['Apo B', 'Odd']);
  });

  it('asks about a large batch in parts, and halves a part whose answer was cut off', async () => {
    const names = Array.from({ length: 160 }, (_, i) => `Test ${String(i).padStart(3, '0')}`);
    const source = await docs(names.map((name) => printedRow({ name })));
    const tasks: ModelTask[] = [];
    const replies = Object.fromEntries(names.map((name) => [name, { key: 'crp' }]));
    const result = await normalizeBatch(source, wonder(replies, tasks));
    assert.deepEqual(
      tasks.map((t) => asked(t).tests.length),
      [40, 40, 40, 40],
    );
    assert.equal(result.stats.values, 160);

    // Answers longer than one test are cut off: 3 questions → 3, 2, 1, 1, 1 → 5 calls.
    const three = await docs(names.slice(0, 3).map((name) => printedRow({ name })));
    let calls = 0;
    const cutting: JsonModel = {
      name: 'Synthetic Wonder',
      async ask<T>(task: ModelTask) {
        calls++;
        if (asked(task).tests.length > 1) throw new AnswerCutOff('cut off');
        return wonder(replies).ask<T>(task);
      },
    };
    assert.equal((await normalizeBatch(three, cutting)).stats.values, 3);
    assert.equal(calls, 5);
    const one = await docs([printedRow({ name: names[0] })]);
    const alwaysCut: JsonModel = {
      name: 'Synthetic Wonder',
      async ask() {
        throw new AnswerCutOff('cut off');
      },
    };
    await assert.rejects(normalizeBatch(one, alwaysCut), AnswerCutOff);
  });

  it('rejects obvious form conflicts and never lets catalogue aliases override unresolved Wonder answers', async () => {
    const source = await docs([
      printedRow({ name: 'Monocytes', unit: '%' }),
      printedRow({ name: 'Total T4', unit: 'nmol/L' }),
      printedRow(),
    ]);
    const result = await normalizeBatch(
      source,
      wonder({ 'Monocytes %': { key: 'mono' }, 'Total T4': { key: 'ft4' } }),
    );
    assert.equal(result.stats.values, 0);
    assert.equal(result.warnings.length, 3);
  });
});

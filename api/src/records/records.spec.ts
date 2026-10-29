import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { SavedDocument } from '../documents/contract.js';
import { DocumentStorage } from '../documents/storage.js';
import type { Observation } from '../results/contract.js';
import { buildRecords, type BuildDocument } from './build.js';
import { KnowledgeStore, type Knowledge } from './knowledge.js';
import { matchTest, nameContextKey, normaliseName } from './match.js';
import type { JsonModel, ModelTask } from './muse.js';
import { parseJson } from './muse.js';
import { RecordsService, validFactor } from './records.service.js';
import { conversionFactor, parseUnit } from './units.js';
import { CATALOGUE } from './catalogue.js';

const EMPTY: Knowledge = { version: 1, names: {}, tests: [], conversions: {} };

let n = 0;
function obs(name: string, valueText: string, unit: string | null, date: string | null = '2024-01-10', doc = 'd1'): Observation {
  const value = /^[\d.,<>]+$/.test(valueText) ? Number(valueText.replace(/[<>]/g, '').replace(',', '.')) : null;
  return {
    id: `${doc}:0:${n++}`, documentId: doc, page: 0, bbox: [0, 0, 10, 10], words: [], name, value, valueText, comparator: null,
    unit, refLow: null, refHigh: null, refText: null, flag: null, date, dateSource: 'label',
  };
}
const doc = (id: string, observations: Observation[]): BuildDocument => ({ id, name: `Doc ${id}`, observations, review: null });

describe('units', () => {
  it('reads the many spellings of the same unit', () => {
    for (const u of ['tys/µl', 'tys/ul*', 'x 10^9/L', '10*9/L', 'Gpt/l', '10^3/µl']) assert.equal(parseUnit(u)?.label, '10^9/L', u);
    for (const u of ['mln/µl', 'x 10^12/L', 'Tpt/l', 'mln/mm3']) assert.equal(parseUnit(u)?.label, '10^12/L', u);
    assert.equal(parseUnit('µIU/ml*')?.dim, 'activity');
    assert.equal(parseUnit('U/l')?.dim, 'activity');
    assert.equal(parseUnit('ug/l')?.dim, 'mass');
    assert.equal(parseUnit('nonsense'), null);
  });

  it('converts by scale and by molar mass', () => {
    const f = (a: string, b: string, m?: number) => conversionFactor(parseUnit(a)!, parseUnit(b)!, m);
    assert.equal(f('g/L', 'g/dL'), 0.1);
    assert.equal(f('tys/µl', '10^9/L'), 1);
    assert.equal(f('µIU/ml', 'mIU/L'), 1);
    assert.ok(Math.abs(f('mmol/l', 'mg/dL', 180.16)! - 18.016) < 1e-9);
    assert.ok(Math.abs(f('µmol/l', 'mg/dL', 113.12)! - 0.011312) < 1e-9);
    assert.equal(f('mmol/l', 'mg/dL'), null);
    assert.equal(f('ml/min', 'ml/min/1.73m²'), null);
  });

  it('accepts a proposed factor only when independent dimensional arithmetic proves it', () => {
    const test = CATALOGUE.find((t) => t.key === 'glucose')!;
    const conversion = { key: 'glucose', test, from: 'mmol/L', to: 'mg/dL', sample: 5 };
    assert.equal(validFactor(18.016, conversion), true);
    assert.equal(validFactor(18, conversion), false);
    assert.equal(validFactor(1, { ...conversion, from: 'unclear' }), false);
    assert.equal(validFactor(1, { ...conversion, from: 'mIU/L' }), false);
  });
});

describe('matching names', () => {
  it('normalises lab codes, units in brackets and diacritics', () => {
    assert.equal(normaliseName('TSH (ICD-9: L69)'), 'tsh');
    assert.equal(normaliseName('Glucose i.P. (SI-Einheit)'), 'glucose i p');
    assert.equal(normaliseName('Płytki krwi'), 'plytki krwi');
    assert.equal(normaliseName('NRBC%'), 'nrbc %');
  });

  it('finds one test across languages', () => {
    for (const name of ['Płytki krwi', 'PLT', 'Platelet Count', 'Thrombozyten', 'Platelets TT']) assert.equal(matchTest(name, null)?.test.key, 'plt', name);
    assert.equal(matchTest('Leukozyten i. VB.', 'Gpt/l')?.test.key, 'wbc');
  });

  it('tells a count from a percentage by the name or the unit', () => {
    assert.equal(matchTest('Neutrofile', 'tys/µl')?.test.key, 'neut');
    assert.equal(matchTest('Neutrofile', '%')?.test.key, 'neut-pct');
    assert.equal(matchTest('Neutrofile %', null)?.test.key, 'neut-pct');
    assert.equal(matchTest('Retikulocyty#', 'mln/mm3')?.test.key, 'retic');
  });

  it('tolerates OCR slips in longer names only', () => {
    assert.equal(matchTest('Hsemogłobin', 'g/L')?.test.key, 'hgb');
    assert.equal(matchTest('AB', null), null);
    assert.equal(matchTest('A', null), null);
  });
});

describe('buildRecords', () => {
  it('merges names and units into one series, converting to the most common unit', () => {
    const { records } = buildRecords(
      [
        doc('a', [obs('Płytki krwi', '245', 'tys/µl', '2023-01-01'), obs('Glukoza', '92', 'mg/dl', '2023-01-01')]),
        doc('b', [obs('PLT', '230', 'tys/ul', '2024-01-01'), obs('Glukoza', '95', 'mg/dl', '2024-01-01')]),
        doc('c', [obs('Platelet Count', '210', 'x 10^9/L', '2012-07-14'), obs('Glucose', '5.0', 'mmol/L', '2012-07-14')]),
      ],
      EMPTY,
      false,
    );
    const all = records.domains.flatMap((d) => d.charts.flatMap((c) => c.series));
    const plt = all.find((s) => s.key === 'plt')!;
    assert.deepEqual(plt.points.map((p) => p.value), [210, 245, 230]);
    assert.deepEqual(plt.printedNames.sort(), ['PLT', 'Platelet Count', 'Płytki krwi']);
    const glucose = all.find((s) => s.key === 'glucose')!;
    assert.equal(glucose.unit, 'mg/dL');
    assert.equal(glucose.points[0].value, 90.08);
    assert.deepEqual(glucose.points[0].conversion, { from: 'mmol/L', factor: 18.016 });
  });

  it('retains distinct observations even when their dates and values agree', () => {
    const { records } = buildRecords([doc('a', [obs('TSH', '1,5', 'µIU/ml', '2024-02-02', 'a')]), doc('b', [obs('TSH', '1,5', 'µIU/ml', '2024-02-02', 'b')])], EMPTY, false);
    const tsh = records.domains[0].charts[0].series[0];
    assert.equal(tsh.points.length, 2);
    assert.equal(tsh.points[0].alsoIn.length, 0);
  });

  it('keeps impossible values, unknown names and undated rows out of the charts, with a reason', () => {
    const { records, pending } = buildRecords(
      [doc('a', [obs('Hemoglobina', '139', 'g/dl'), obs('AB', '109', null), obs('MCV', '88', 'fl', null), obs('Przeciwciała anty HCV', 'niereaktywny', null)])],
      EMPTY,
      true,
    );
    assert.equal(records.stats.values, 0);
    assert.deepEqual(records.warnings.map((w) => w.reason).sort(), ['implausible', 'no-date', 'unrecognised']);
    assert.deepEqual(pending.names.map((p) => p.printedName), ['AB']);
    assert.equal(records.textResults[0].printedValue, 'niereaktywny');
  });

  it('puts lines on one chart only when they share a unit and a scale, at most four', () => {
    const rows = ['Leukocyty 5', 'Neutrofile 3', 'Limfocyty 2', 'Monocyty 0,5', 'Eozynofile 0,1', 'Bazofile 0,03'].map((s) => {
      const [name, v] = s.split(' ');
      return obs(name, v, 'tys/µl');
    });
    const { records } = buildRecords([doc('a', rows)], EMPTY, false);
    const charts = records.domains.find((d) => d.key === 'white-cells')!.charts.map((c) => c.series.map((s) => s.key));
    assert.deepEqual(charts, [['wbc', 'neut', 'lymph', 'mono'], ['eos', 'baso']]);
  });

  it('withholds missing and incompatible units and ignores cached model conversion guesses', () => {
    const knowledge: Knowledge = { ...EMPTY, conversions: { 'tsh|mg/dl|mIU/L': { factor: 1, note: 'model guess' } } };
    const { records, pending } = buildRecords([doc('a', [obs('TSH', '1.5', null), obs('TSH', '1.5', 'mg/dl'), obs('TSH', '1.5', 'uTU/ml')])], knowledge, true);
    assert.equal(records.stats.values, 0);
    assert.equal(records.warnings.length, 3);
    assert.ok(records.warnings.every((w) => w.reason === 'unit'));
    assert.equal(pending.conversions.length, 0);
  });

  it('retains near-equal and comparator-qualified readings on the same date', () => {
    const rows = [obs('TSH', '1.5', 'mIU/L'), obs('TSH', '1.501', 'mIU/L'), { ...obs('TSH', '<1.5', 'mIU/L'), comparator: '<' as const }];
    const { records } = buildRecords([doc('a', rows)], EMPTY, false);
    const points = records.domains[0].charts[0].series[0].points;
    assert.equal(points.length, 3);
    assert.deepEqual(points.map((p) => p.comparator), [null, null, '<']);
  });

  it('requires a neutral source check for an extreme reading and accepts user confirmation', () => {
    const reading = obs('Hemoglobina', '139', 'g/dl');
    const first = buildRecords([doc('a', [reading])], EMPTY, true);
    assert.equal(first.records.warnings[0].reason, 'implausible');
    assert.doesNotMatch(first.records.warnings[0].detail, /impossible|not a possible|probably/i);
    const reviewed = doc('a', [{ ...reading, confirmed: true, revision: 'confirmed' }]);
    const current = buildRecords([reviewed], EMPTY, true);
    assert.equal(current.pending.reviews.length, 0);
    reviewed.review = { hash: 'old-review', flags: [{ id: reading.id, reason: 'model disagrees' }] };
    const confirmed = buildRecords([reviewed], EMPTY, true);
    assert.equal(confirmed.records.stats.values, 1);
    assert.equal(confirmed.records.warnings.length, 0);
    assert.equal(confirmed.records.domains[0].charts[0].series[0].points[0].confirmed, true);
  });

  it('never applies a review to changed readings', () => {
    const reading = obs('TSH', '1.5', 'mIU/L');
    const input = doc('a', [reading]);
    input.review = { hash: 'old', flags: [{ id: reading.id, reason: 'old flag' }] };
    const { records, pending } = buildRecords([input], EMPTY, true);
    assert.equal(records.stats.values, 1);
    assert.equal(records.warnings.length, 0);
    assert.equal(pending.reviews.length, 1);
  });

  it('keeps learned name mappings separate for different unit contexts', () => {
    const knowledge: Knowledge = { ...EMPTY, names: {
      [nameContextKey('Local name', '%')]: { key: 'neut-pct' },
      [nameContextKey('Local name', '10^9/L')]: { key: 'neut' },
    } };
    const { records } = buildRecords([doc('a', [obs('Local name', '60', '%'), obs('Local name', '3', '10^9/L')])], knowledge, false);
    assert.equal(records.stats.tests, 2);
  });
});

describe('Muse Spark answers', () => {
  it('parses JSON wrapped in a code fence', () => {
    assert.deepEqual(parseJson('Sure:\n```json\n{"a":1}\n```'), { a: 1 });
  });

  it('maps unknown names, converts units and reviews, caching every answer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-'));
    try {
      const storage = new DocumentStorage(root);
      const page = { index: 0, width: 1500, height: 200, hasImage: false, ocr: false, regions: [], words: [] };
      // Words laid out as a headed table: test, value, unit.
      const line = (l: number, cells: string[]) => cells.map((t, i) => ({ t, b: [10 + i * 300, 10 + l * 20, t.length * 8, 14] as [number, number, number, number], l }));
      const words = [
        ...line(0, ['Data', 'pobrania:', '2024-03-01']),
        ...line(1, ['Badanie', 'Wynik', 'Jedn.', 'Norma']),
        ...line(2, ['Osmolalność', '290', 'mOsm/kg', '275-295']),
        ...line(3, ['Kreatynina', '70', 'µmol/l', '45-84']),
        ...line(4, ['Hemoglobina', '13,5', 'g/dl', '12-16']),
      ];
      await storage.create('u1', { name: 'Doc', sourceKind: 'pdf', hiddenCount: 0, pages: [{ ...page, words }] }, new Map());

      const asked: string[] = [];
      const model: JsonModel = {
        name: 'stub',
        async ask<T>(task: ModelTask): Promise<T> {
          asked.push(task.kind);
          if (task.kind === 'map-names') {
            return { answers: [{ name: 'Osmolalność', key: null, newTest: { key: 'osmolality', label: 'Osmolality', domain: 'electrolytes', unit: 'mOsm/kg' }, notATest: false, reason: 'Serum osmolality' }] } as T;
          }
          if (task.kind === 'convert-unit') return { factor: 1, note: 'same unit' } as T;
          return { flags: [{ row: 1, reason: 'Name does not match' }] } as T;
        },
      };
      const knowledge = new KnowledgeStore(join(root, '_shared'));
      const service = new RecordsService(storage, knowledge, model);
      const first = await service.records('u1');
      assert.equal(first.model.state, 'working');
      // Let the background job finish.
      for (let i = 0; i < 50 && (await service.records('u1')).model.state === 'working'; i++) await new Promise((r) => setTimeout(r, 20));
      const done = await service.records('u1');
      assert.equal(done.model.state, 'ready');
      assert.equal(done.model.waiting, 0);
      assert.ok(asked.includes('map-names') && asked.includes('review'));
      assert.ok((await knowledge.get()).tests.some((t) => t.key === 'osmolality'));
      // Row 1 of the review was flagged: it is a warning now, by the model.
      assert.equal(done.warnings.filter((w) => w.by === 'model').length, 1);
      // Nothing is asked twice.
      const before = asked.length;
      await service.records('u1');
      await new Promise((r) => setTimeout(r, 50));
      assert.equal(asked.length, before);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps a failed job visible without retrying on polling, then allows an explicit retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-retry-'));
    try {
      const storage = new DocumentStorage(root);
      const words = ['Collected 2024-01-01', 'TSH 1.5 mIU/L'].flatMap((line, l) => line.split(' ').map((t, i) => ({ t, b: [20 + i * 180, 20 + l * 30, t.length * 8, 18] as [number, number, number, number], l })));
      await storage.create('u1', { name: 'Synthetic report', sourceKind: 'pdf', hiddenCount: 0, pages: [{ index: 0, width: 1000, height: 200, hasImage: false, ocr: false, words, regions: [] }] }, new Map());
      let calls = 0, fail = true;
      const model: JsonModel = { name: 'stub', async ask<T>(): Promise<T> { calls++; if (fail) throw new Error('Synthetic failure'); return { flags: [] } as T; } };
      const service = new RecordsService(storage, (userId) => new KnowledgeStore(join(root, userId)), model);
      await service.records('u1');
      for (let i = 0; i < 50 && (await service.records('u1')).model.state === 'working'; i++) await new Promise((r) => setTimeout(r, 10));
      for (let i = 0; i < 5; i++) {
        const failed = await service.records('u1');
        assert.equal(failed.model.state, 'error');
        assert.equal(failed.model.waiting, 1);
        assert.match(failed.model.message!, /Retry checks/);
      }
      assert.equal(calls, 1);
      fail = false;
      assert.equal((await service.retry('u1')).model.state, 'working');
      for (let i = 0; i < 50 && (await service.records('u1')).model.state === 'working'; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal((await service.records('u1')).model.state, 'ready');
      assert.equal(calls, 2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('bounds each job to eight calls and truthfully leaves the remaining work for retry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'records-bounded-'));
    try {
      const storage = new DocumentStorage(root);
      const words = ['Collected 2024-01-01', 'TSH 1.5 mIU/L'].flatMap((line, l) => line.split(' ').map((t, i) => ({ t, b: [20 + i * 180, 20 + l * 30, t.length * 8, 18] as [number, number, number, number], l })));
      for (let i = 0; i < 9; i++) await storage.create('u1', { name: `Report ${i}`, sourceKind: 'pdf', hiddenCount: 0, pages: [{ index: 0, width: 1000, height: 200, hasImage: false, ocr: false, words, regions: [] }] }, new Map());
      let calls = 0;
      const model: JsonModel = { name: 'stub', async ask<T>(): Promise<T> { calls++; return { flags: [] } as T; } };
      const service = new RecordsService(storage, new KnowledgeStore(join(root, 'knowledge')), model);
      await service.records('u1');
      for (let i = 0; i < 100 && (await service.records('u1')).model.state === 'working'; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal(calls, 8);
      const stopped = await service.records('u1');
      assert.equal(stopped.model.state, 'error');
      assert.equal(stopped.model.waiting, 1);
      assert.equal(stopped.stats.values, 9);
      await service.retry('u1');
      for (let i = 0; i < 100 && (await service.records('u1')).model.state === 'working'; i++) await new Promise((r) => setTimeout(r, 10));
      assert.equal((await service.records('u1')).model.state, 'ready');
      assert.equal(calls, 9);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

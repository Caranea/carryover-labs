import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Observation } from '../shared/results.js';
import { buildRecords, type BuildDocument } from './build.js';
import { CATALOGUE } from '../shared/catalogue.js';
import { conversionFactor, parseUnit } from './units.js';

let n = 0;
/** An observation already mapped to a catalogue test key (or `null` for an unresolved identity). */
interface Mapped extends Observation {
  key: string | null;
}
function obs(
  key: string | null,
  name: string,
  valueText: string,
  unit: string | null,
  date: string | null = '2024-01-10',
  doc = 'd1',
): Mapped {
  const value = /^[\d.,<>]+$/.test(valueText)
    ? Number(valueText.replace(/[<>]/g, '').replace(',', '.'))
    : null;
  return {
    key,
    id: `${doc}:0:${n++}`,
    documentId: doc,
    page: 0,
    bbox: [0, 0, 10, 10],
    words: [],
    name,
    value,
    valueText,
    comparator: null,
    unit,
    refLow: null,
    refHigh: null,
    refText: null,
    flag: null,
    date,
    dateSource: 'label',
  };
}
function doc(id: string, observations: Mapped[]): BuildDocument {
  const mappings = Object.fromEntries(
    observations.map((o) => [
      o.id,
      {
        test: o.key ? (CATALOGUE.find((t) => t.key === o.key) ?? null) : null,
        reason: o.key ? 'Synthetic mapping' : 'Ambiguous test identity.',
      },
    ]),
  );
  return { id, name: `Doc ${id}`, observations, mappings };
}
const series = (records: ReturnType<typeof buildRecords>) =>
  records.domains.flatMap((d) => d.charts.flatMap((c) => c.series));

describe('units', () => {
  it('reads the many spellings of the same unit', () => {
    for (const u of ['tys/µl', 'tys/ul*', 'x 10^9/L', '10*9/L', 'Gpt/l', '10^3/µl'])
      assert.equal(parseUnit(u)?.label, '10^9/L', u);
    for (const u of ['mln/µl', 'x 10^12/L', 'Tpt/l', 'mln/mm3'])
      assert.equal(parseUnit(u)?.label, '10^12/L', u);
    assert.equal(parseUnit('µIU/ml*')?.dim, 'activity');
    assert.equal(parseUnit('U/l')?.dim, 'activity');
    assert.equal(parseUnit('ug/l')?.dim, 'mass');
    assert.equal(parseUnit('nonsense'), null);
  });

  it('converts by scale and by molar mass', () => {
    const f = (a: string, b: string, m?: number) =>
      conversionFactor(parseUnit(a)!, parseUnit(b)!, m);
    assert.equal(f('g/L', 'g/dL'), 0.1);
    assert.equal(f('tys/µl', '10^9/L'), 1);
    assert.equal(f('µIU/ml', 'mIU/L'), 1);
    assert.ok(Math.abs(f('mmol/l', 'mg/dL', 180.16)! - 18.016) < 1e-9);
    assert.ok(Math.abs(f('µmol/l', 'mg/dL', 113.12)! - 0.011312) < 1e-9);
    assert.equal(f('mmol/l', 'mg/dL'), null);
    assert.equal(f('ml/min', 'ml/min/1.73m²'), null);
  });
});

describe('buildRecords', () => {
  it('merges mapped names and units into one series, converting to the most common unit', () => {
    const records = buildRecords([
      doc('a', [
        obs('plt', 'Płytki krwi', '245', 'tys/µl', '2023-01-01'),
        obs('glucose', 'Glukoza', '92', 'mg/dl', '2023-01-01'),
      ]),
      doc('b', [
        obs('plt', 'PLT', '230', 'tys/ul', '2024-01-01'),
        obs('glucose', 'Glukoza', '95', 'mg/dl', '2024-01-01'),
      ]),
      doc('c', [
        obs('plt', 'Platelet Count', '210', 'x 10^9/L', '2012-07-14'),
        obs('glucose', 'Glucose', '5.0', 'mmol/L', '2012-07-14'),
      ]),
    ]);
    const plt = series(records).find((s) => s.key === 'plt')!;
    assert.deepEqual(
      plt.points.map((p) => p.value),
      [210, 245, 230],
    );
    assert.deepEqual(plt.printedNames.sort(), ['PLT', 'Platelet Count', 'Płytki krwi']);
    const glucose = series(records).find((s) => s.key === 'glucose')!;
    assert.equal(glucose.unit, 'mg/dL');
    assert.equal(glucose.points[0].value, 90.08);
    assert.deepEqual(glucose.points[0].conversion, { from: 'mmol/L', factor: 18.016 });
  });

  it('retains distinct observations even when their dates and values agree', () => {
    const records = buildRecords([
      doc('a', [obs('tsh', 'TSH', '1,5', 'µIU/ml', '2024-02-02', 'a')]),
      doc('b', [obs('tsh', 'TSH', '1,5', 'µIU/ml', '2024-02-02', 'b')]),
    ]);
    const tsh = records.domains[0].charts[0].series[0];
    assert.equal(tsh.points.length, 2);
    assert.equal(tsh.points[0].alsoIn.length, 0);
  });

  it('keeps implausible values, unresolved identities and undated rows out of the charts, with a reason', () => {
    const records = buildRecords([
      doc('a', [
        obs('hgb', 'Hemoglobina', '139', 'g/dl'),
        obs(null, 'AB', '109', null),
        obs('mcv', 'MCV', '88', 'fl', null),
        obs('anti-hcv', 'Przeciwciała anty HCV', 'niereaktywny', null),
      ]),
    ]);
    assert.equal(records.stats.values, 0);
    assert.deepEqual(records.warnings.map((w) => w.reason).sort(), [
      'implausible',
      'model',
      'no-date',
    ]);
    assert.equal(records.textResults[0].printedValue, 'niereaktywny');
  });

  it('holds uncertain transcriptions for review until the user confirms them', () => {
    const uncertain = {
      ...obs('tsh', 'TSH', '1.5', 'mIU/L'),
      transcription: { doubt: 'Blurred digit' } as Observation['transcription'],
    };
    assert.equal(buildRecords([doc('a', [uncertain])]).warnings[0].reason, 'model');
    assert.equal(buildRecords([doc('a', [{ ...uncertain, confirmed: true }])]).stats.values, 1);
  });

  it('shows a panel in report order, one chart per test', () => {
    const rows = [
      ['plt', 'Płytki krwi', '250'],
      ['wbc', 'Leukocyty', '5'],
      ['rbc', 'Erytrocyty', '4,6'],
    ].map(([key, name, v]) => obs(key, name, v, key === 'rbc' ? 'mln/µl' : 'tys/µl'));
    const panel = buildRecords([doc('a', rows)]).domains;
    assert.deepEqual(
      panel.map((d) => d.key),
      ['blood-count'],
    );
    assert.deepEqual(
      panel[0].charts.map((c) => c.series.map((s) => s.key)),
      [['rbc'], ['wbc'], ['plt']],
    );
  });

  it('reads seconds and per mille, needs no unit for INR, and treats "-" as no unit', () => {
    const records = buildRecords([
      doc('a', [
        obs('pt', 'Prothrombin Time', '13', 'seconds'),
        obs('retic-pct', 'Retikulocyty', '10,9', '%o*'),
        obs('inr', 'INR', '1,00', null),
        obs('tsh', 'TSH', '1.5', '-'),
      ]),
    ]);
    assert.equal(records.stats.values, 3);
    assert.equal(series(records).find((s) => s.key === 'retic-pct')?.unit, '‰');
    assert.match(records.warnings[0].detail, /unit is missing/);
  });

  it('withholds missing and incompatible units', () => {
    const records = buildRecords([
      doc('a', [
        obs('tsh', 'TSH', '1.5', null),
        obs('tsh', 'TSH', '1.5', 'mg/dl'),
        obs('tsh', 'TSH', '1.5', 'uTU/ml'),
      ]),
    ]);
    assert.equal(records.stats.values, 0);
    assert.equal(records.warnings.length, 3);
    assert.ok(records.warnings.every((w) => w.reason === 'unit'));
  });

  it('retains near-equal and comparator-qualified readings on the same date', () => {
    const rows = [
      obs('tsh', 'TSH', '1.5', 'mIU/L'),
      obs('tsh', 'TSH', '1.501', 'mIU/L'),
      { ...obs('tsh', 'TSH', '<1.5', 'mIU/L'), comparator: '<' as const },
    ];
    const points = buildRecords([doc('a', rows)]).domains[0].charts[0].series[0].points;
    assert.equal(points.length, 3);
    assert.deepEqual(
      points.map((p) => p.comparator),
      [null, null, '<'],
    );
  });

  it('asks for a neutral source check on an extreme reading and accepts user confirmation', () => {
    const reading = obs('hgb', 'Hemoglobina', '139', 'g/dl');
    const first = buildRecords([doc('a', [reading])]);
    assert.equal(first.warnings[0].reason, 'implausible');
    assert.doesNotMatch(first.warnings[0].detail, /impossible|not a possible|probably/i);
    const confirmed = buildRecords([doc('a', [{ ...reading, confirmed: true }])]);
    assert.equal(confirmed.stats.values, 1);
    assert.equal(confirmed.domains[0].charts[0].series[0].points[0].confirmed, true);
  });
});

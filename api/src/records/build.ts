import type { Observation } from '../shared/results.js';
import { CATALOGUE, DOMAINS, type CatalogueTest } from '../shared/catalogue.js';
import type { Word } from '../batches/normalization.js';
import type {
  RecordDomain,
  RecordPoint,
  RecordSeries,
  RecordWarning,
  RecordsResponse,
  SourceRef,
  TextResult,
} from '../shared/records.js';
import { asCount, cleanUnit, conversionFactor, parseUnit, type Unit } from './units.js';
import { maybeThousands } from '../shared/tokens.js';

export interface BuildDocument {
  id: string;
  name: string;
  observations: Observation[];
  /** The normalized test identity for each observation id; `test: null` keeps it for review. */
  mappings: Record<string, { test: CatalogueTest | null; reason: string; word?: Word }>;
}

interface Row {
  obs: Observation;
  test: CatalogueTest;
  src: SourceRef;
  unit: Unit | null;
}

/**
 * Turn mapped observations into the record. Deterministic: the test identities
 * come from normalization, and every number comes from unit arithmetic here.
 * Anything uncertain stays out of the charts as a warning with a reason.
 */
export function buildRecords(
  docs: BuildDocument[],
  extraTests: CatalogueTest[] = [],
): Omit<RecordsResponse, 'model'> {
  const tests = new Map<string, CatalogueTest>(
    [...CATALOGUE, ...extraTests].map((t) => [t.key, t]),
  );
  const warnings: RecordWarning[] = [];
  const textResults: TextResult[] = [];
  const rows: Row[] = [];

  const warn = (
    o: Observation,
    src: SourceRef,
    reason: RecordWarning['reason'],
    detail: string,
    by: RecordWarning['by'] = 'rules',
  ) =>
    warnings.push({
      ...src,
      reason,
      detail,
      by,
      printedName: o.name,
      printedValue: o.valueText,
      printedUnit: o.unit,
      date: o.date,
    });

  for (const doc of docs) {
    for (const o of doc.observations) {
      const src: SourceRef = {
        observationId: o.id,
        documentId: doc.id,
        documentName: doc.name,
        page: o.page,
        bbox: o.bbox,
        confirmed: o.confirmed,
      };
      // A row with no result and nothing hard to read is a heading, not a reading.
      if (!o.valueText.trim() && !o.transcription?.doubt && !o.confirmed) continue;
      const mapping = doc.mappings[o.id];
      const uncertain = !o.confirmed && (!!o.transcription?.doubt || !o.valueText);
      if (!mapping?.test || uncertain) {
        warn(
          o,
          src,
          'model',
          mapping?.reason || 'The source reading or test identity is uncertain. Check the source.',
          'model',
        );
        continue;
      }
      const test = mapping.test;
      if (o.value === null) {
        textResults.push({
          ...src,
          key: test.key,
          label: test.label,
          domain: test.domain,
          date: o.date,
          printedName: o.name,
          printedValue: o.valueText,
          dateKind: o.dateKind ?? null,
          english: mapping.word?.english ?? null,
          level: mapping.word?.level ?? null,
        });
        continue;
      }
      if (!o.date) {
        warn(
          o,
          src,
          'no-date',
          'The collection date is missing or ambiguous. Check the source and confirm a date to add this reading to the timeline.',
        );
        continue;
      }
      // A "-" in the unit column is no unit. A unit the parser does not know still matches a
      // test printed in exactly that unit, and a test without units (pH, INR) needs none.
      const printed = o.unit && !/^\s*-+\s*$/.test(o.unit) ? o.unit : null;
      const same = !!printed && !!test.unit && cleanUnit(printed) === cleanUnit(test.unit);
      const own: Unit = { dim: 'ratio', scale: 1, label: test.unit };
      const home = parseUnit(test.unit) ?? (same || !test.unit ? own : null);
      const parsed = printed
        ? same
          ? home
          : parseUnit(printed)
        : home?.dim === 'ratio'
          ? home
          : null;
      const unit = parsed && home?.dim === 'count' ? asCount(parsed, printed!) : parsed;
      if (!unit || !home || conversionFactor(unit, home, test.molarMass) === null) {
        warn(
          o,
          src,
          'unit',
          !printed
            ? 'The unit is missing. Check the source and enter its unit before this reading can be compared.'
            : `The unit “${printed}” could not be verified for ${test.label}. Check the source before comparing this reading.`,
        );
        continue;
      }
      if (!o.confirmed && unit.dim === 'count' && maybeThousands(o.valueText)) {
        warn(
          o,
          src,
          'implausible',
          `“${o.valueText}” could be ${o.valueText.replace(',', '')} or ${o.valueText.replace(',', '.')}. Check the source and confirm the value.`,
        );
        continue;
      }
      rows.push({ obs: o, test, src, unit });
    }
  }

  // One series per test, in the unit printed most often for it.
  const byTest = new Map<string, Row[]>();
  for (const r of rows) byTest.set(r.test.key, [...(byTest.get(r.test.key) ?? []), r]);

  const series: RecordSeries[] = [];
  for (const [key, list] of byTest) {
    const test = list[0].test;
    const target = seriesUnit(test, list);
    const points: RecordPoint[] = [];
    for (const r of list) {
      const o = r.obs;
      const factor = r.unit ? conversionFactor(r.unit, target, test.molarMass) : null;
      if (factor === null) {
        warnings.push({
          ...r.src,
          reason: 'unit',
          detail: `“${o.unit}” cannot be safely converted to ${target.label}. Check the printed unit.`,
          by: 'rules',
          printedName: o.name,
          printedValue: o.valueText,
          printedUnit: o.unit,
          date: o.date,
        });
        continue;
      }
      const value = factor === 1 ? o.value! : round(o.value! * factor);
      const implausible = o.confirmed ? null : outsidePlausible(test, target, value);
      if (implausible) {
        warnings.push({
          ...r.src,
          reason: 'implausible',
          detail: implausible,
          by: 'rules',
          printedName: o.name,
          printedValue: o.valueText,
          printedUnit: o.unit,
          date: o.date,
        });
        continue;
      }
      points.push({
        ...r.src,
        date: o.date!,
        value,
        comparator: o.comparator,
        printedName: o.name,
        printedValue: o.valueText,
        printedUnit: o.unit,
        printedReference: o.refText,
        flag: o.flag,
        dateKind: o.dateKind ?? null,
        conversion: factor !== 1 ? { from: o.unit ?? '', factor } : null,
        alsoIn: [],
      });
    }
    // Equal dates and close values do not prove that two specimens are duplicates.
    const merged = points.sort((a, b) => a.date.localeCompare(b.date));
    if (merged.length) {
      series.push({
        key,
        label: test.label,
        unit: target.label,
        printedNames: [...new Set(list.map((r) => r.obs.name))],
        points: merged,
      });
    }
  }

  const populated = series.filter((s) => s.points.length > 0);

  const domains = groupIntoCharts(populated, tests);
  const dates = populated.flatMap((s) => s.points.map((p) => p.date)).sort();
  return {
    domains,
    textResults: textResults.sort(
      (a, b) => a.label.localeCompare(b.label) || (a.date ?? '').localeCompare(b.date ?? ''),
    ),
    warnings,
    stats: {
      documents: docs.length,
      tests: populated.length,
      values: populated.reduce((n, s) => n + s.points.length, 0),
      from: dates[0] ?? null,
      to: dates[dates.length - 1] ?? null,
    },
  };
}

/** The unit printed most often for this test, or the catalogue's unit. */
function seriesUnit(test: CatalogueTest, rows: Row[]): Unit {
  const counts = new Map<string, { unit: Unit; n: number }>();
  for (const r of rows) {
    if (!r.unit) continue;
    const c = counts.get(r.unit.label) ?? { unit: r.unit, n: 0 };
    c.n++;
    counts.set(r.unit.label, c);
  }
  const best = [...counts.values()].sort((a, b) => b.n - a.n)[0];
  return best?.unit ?? parseUnit(test.unit) ?? { dim: 'ratio', scale: 1, label: test.unit };
}

/** Conservative verification bounds prompt a source check; they are not a medical judgment. */
function outsidePlausible(test: CatalogueTest, unit: Unit, value: number): string | null {
  if (!test.plausible) return null;
  const home = parseUnit(test.unit);
  const factor = home
    ? conversionFactor(unit, home, test.molarMass)
    : unit.label === test.unit
      ? 1
      : null;
  if (factor === null) return null;
  const v = value * factor;
  const [lo, hi] = test.plausible;
  if (v >= lo && v <= hi) return null;
  return `Check ${value} ${unit.label} against the source. This reading is outside the automated verification bounds; confirm it if it matches the report.`;
}

/** Panels in report order; within a panel, tests in catalogue order, one chart each. */
export function groupIntoCharts(
  series: RecordSeries[],
  tests: Map<string, CatalogueTest>,
): RecordDomain[] {
  const order = new Map([...tests.keys()].map((k, i) => [k.split(':')[0], i]));
  const rank = (s: RecordSeries) => order.get(s.key.split(':')[0]) ?? 999;
  return DOMAINS.flatMap(({ key, label }) => {
    const list = series
      .filter((s) => (tests.get(s.key)?.domain ?? 'other') === key)
      .sort((a, b) => rank(a) - rank(b));
    return list.length
      ? [{ key, label, charts: list.map((s) => ({ id: s.key, unit: s.unit, series: [s] })) }]
      : [];
  });
}

function round(n: number): number {
  return Number(n.toPrecision(12));
}

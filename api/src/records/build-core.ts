import type { Observation } from '../results/contract.js';
import { CATALOGUE, DOMAINS, type CatalogueTest } from './catalogue.js';
import type {
  RecordChart,
  RecordDomain,
  RecordPoint,
  RecordSeries,
  RecordWarning,
  RecordsResponse,
  SourceRef,
  TextResult,
} from './contract.js';
import type { Knowledge } from './knowledge-types.js';
import { matchTest, nameContextKey } from './match.js';
import { asCount, conversionFactor, parseUnit, type Unit } from './units.js';

export interface BuildDocument {
  id: string;
  name: string;
  observations: Observation[];
  review: Review | null;
}

/** The model's review of one document, kept until the document's rows change. */
export interface Review {
  hash: string;
  flags: { id: string; reason: string }[];
}

/** Questions for the model that would let more rows into the record. */
export interface Pending {
  names: { name: string; printedName: string; unit: string | null; value: string }[];
  conversions: { key: string; test: CatalogueTest; from: string; to: string; sample: number }[];
  reviews: { documentId: string; hash: string; rows: ReviewRow[] }[];
}

export interface ReviewRow {
  id: string;
  test: string;
  printedName: string;
  value: string;
  unit: string | null;
  converted: string;
  date: string;
  revision?: string;
}

/** At most this many lines on one chart, so it stays readable. */
const MAX_SERIES = 4;
/** Lines share a chart only when their typical values are within this ratio, so none is flattened. */
const MAX_SPREAD = 12;

interface Row {
  obs: Observation;
  test: CatalogueTest;
  src: SourceRef;
  unit: Unit | null;
}

/**
 * Turn raw observations into the record. Deterministic: the catalogue, unit
 * arithmetic and the model's cached decisions only. Anything that needs a new
 * model decision is returned in `pending` and kept out of the charts meanwhile.
 */
export function buildRecords(docs: BuildDocument[], knowledge: Knowledge, modelOn: boolean, reviewHash: (rows: ReviewRow[]) => string = JSON.stringify): { records: Omit<RecordsResponse, 'model'>; pending: Pending } {
  const tests = new Map<string, CatalogueTest>([...CATALOGUE, ...knowledge.tests].map((t) => [t.key, t]));
  const learned = new Map<string, CatalogueTest>();
  for (const [name, d] of Object.entries(knowledge.names)) {
    const test = d.key ? tests.get(d.key) : undefined;
    if (test) learned.set(name, test);
  }

  const warnings: RecordWarning[] = [];
  const textResults: TextResult[] = [];
  const pending: Pending = { names: [], conversions: [], reviews: [] };
  const askedNames = new Set<string>();
  const rows: Row[] = [];

  const warn = (o: Observation, src: SourceRef, reason: RecordWarning['reason'], detail: string, by: RecordWarning['by'] = 'rules') =>
    warnings.push({ ...src, reason, detail, by, printedName: o.name, printedValue: o.valueText, printedUnit: o.unit, date: o.date });

  for (const doc of docs) {
    for (const o of doc.observations) {
      const src: SourceRef = { observationId: o.id, documentId: doc.id, documentName: doc.name, page: o.page, bbox: o.bbox, confirmed: o.confirmed };
      const match = matchTest(o.name, o.unit, learned);
      if (!match) {
        const name = nameContextKey(o.name, o.unit);
        const known = knowledge.names[name];
        if (known && known.key === null) {
          warn(o, src, 'not-a-test', 'The automatic check could not match this name to a lab test. Check the source and correct the name if needed.', 'model');
        } else {
          warn(o, src, 'unrecognised', modelOn ? 'Not in the list of known tests yet; Muse Spark will check it' : 'Not in the list of known tests');
          if (modelOn && !known && !askedNames.has(name)) {
            askedNames.add(name);
            pending.names.push({ name, printedName: o.name, unit: o.unit, value: o.valueText });
          }
        }
        continue;
      }
      if (o.value === null) {
        textResults.push({ ...src, key: match.test.key, label: match.test.label, date: o.date, printedName: o.name, printedValue: o.valueText });
        continue;
      }
      if (!o.date) {
        warn(o, src, 'no-date', 'The collection date is missing or ambiguous. Check the source and confirm a date to add this reading to the timeline.');
        continue;
      }
      const parsed = parseUnit(o.unit);
      const testDim = parseUnit(match.test.unit)?.dim;
      const unit = parsed && testDim === 'count' ? asCount(parsed, o.unit!) : parsed;
      const home = parseUnit(match.test.unit);
      if (!o.unit || !unit || !home || conversionFactor(unit, home, match.test.molarMass) === null) {
        warn(o, src, 'unit', !o.unit
          ? 'The unit is missing. Check the source and enter its unit before this reading can be compared.'
          : `The unit “${o.unit}” could not be verified for ${match.test.label}. Check the source before comparing this reading.`);
        continue;
      }
      rows.push({ obs: o, test: match.test, src, unit });
    }
  }

  // One series per test, in the unit printed most often for it.
  const byTest = new Map<string, Row[]>();
  for (const r of rows) byTest.set(r.test.key, [...(byTest.get(r.test.key) ?? []), r]);

  const series: RecordSeries[] = [];
  const reviewRows = new Map<string, ReviewRow[]>();
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
      const reason = implausible;
      const row: ReviewRow = { id: o.id, test: test.label, printedName: o.name, value: o.valueText, unit: o.unit, converted: `${value} ${target.label}`, date: o.date!, revision: o.revision };
      if (!o.confirmed) reviewRows.set(r.src.documentId, [...(reviewRows.get(r.src.documentId) ?? []), row]);
      if (reason) {
        warnings.push({
          ...r.src,
          reason: 'implausible',
          detail: reason,
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
        conversion: factor !== 1 ? { from: o.unit ?? '', factor } : null,
        alsoIn: [],
      });
    }
    // Equal dates and close values do not prove that two specimens are duplicates.
    const merged = points.sort((a, b) => a.date.localeCompare(b.date));
    if (merged.length) {
      series.push({ key, label: test.label, unit: target.label, printedNames: [...new Set(list.map((r) => r.obs.name))], points: merged });
    }
  }

  // Apply only a review of these exact readings. Confirmation always wins over a model suggestion.
  for (const doc of docs) {
    const list = reviewRows.get(doc.id);
    if (!list?.length) continue;
    const hash = reviewHash(list);
    if (doc.review?.hash !== hash) {
      if (modelOn) pending.reviews.push({ documentId: doc.id, hash, rows: list });
      continue;
    }
    const flags = new Set(doc.review.flags.map((f) => f.id));
    for (const item of series) {
      item.points = item.points.filter((point) => {
        if (point.documentId !== doc.id || point.confirmed || !flags.has(point.observationId)) return true;
        const source = doc.observations.find((o) => o.id === point.observationId)!;
        warn(source, point, 'model', 'The automatic check could not verify this reading. Compare it with the source and confirm or correct it.', 'model');
        return false;
      });
    }
  }
  const populated = series.filter((s) => s.points.length > 0);

  const domains = groupIntoCharts(populated, tests);
  const dates = populated.flatMap((s) => s.points.map((p) => p.date)).sort();
  return {
    records: {
      domains,
      textResults: textResults.sort((a, b) => a.label.localeCompare(b.label) || (a.date ?? '').localeCompare(b.date ?? '')),
      warnings,
      stats: {
        documents: docs.length,
        tests: populated.length,
        values: populated.reduce((n, s) => n + s.points.length, 0),
        from: dates[0] ?? null,
        to: dates[dates.length - 1] ?? null,
      },
    },
    pending,
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
  const factor = home ? conversionFactor(unit, home, test.molarMass) : unit.label === test.unit ? 1 : null;
  if (factor === null) return null;
  const v = value * factor;
  const [lo, hi] = test.plausible;
  if (v >= lo && v <= hi) return null;
  return `Check ${value} ${unit.label} against the source. This reading is outside the automated verification bounds; confirm it if it matches the report.`;
}

/**
 * Charts per domain, in catalogue order. Lines share a chart only when the
 * tests belong together (the catalogue's `group`: the white cell counts, the
 * liver enzymes), share a unit and a scale (so 0.03 and 300 are never on one
 * axis), and a chart holds at most MAX_SERIES lines.
 */
export function groupIntoCharts(series: RecordSeries[], tests: Map<string, CatalogueTest>): RecordDomain[] {
  const order = new Map([...tests.keys()].map((k, i) => [k, i]));
  const byDomain = new Map<string, RecordSeries[]>();
  for (const s of series) {
    const domain = tests.get(s.key)?.domain ?? 'other';
    byDomain.set(domain, [...(byDomain.get(domain) ?? []), s]);
  }
  const domains: RecordDomain[] = [];
  for (const { key, label } of DOMAINS) {
    const list = (byDomain.get(key) ?? []).sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
    if (!list.length) continue;
    const charts: RecordChart[] = [];
    for (const s of list) {
      const typical = median(s.points.map((p) => Math.abs(p.value))) || 1e-6;
      const group = tests.get(s.key)?.group;
      const home = charts.find((c) => {
        if (!group || tests.get(c.series[0].key)?.group !== group) return false;
        if (c.unit !== s.unit || c.series.length >= MAX_SERIES) return false;
        const all = [...c.series.map((x) => median(x.points.map((p) => Math.abs(p.value))) || 1e-6), typical];
        return Math.max(...all) / Math.min(...all) <= MAX_SPREAD;
      });
      if (home) home.series.push(s);
      else charts.push({ id: `${key}-${charts.length}`, unit: s.unit, series: [s] });
    }
    domains.push({ key, label, charts });
  }
  return domains;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function round(n: number): number {
  return Number(n.toPrecision(12));
}

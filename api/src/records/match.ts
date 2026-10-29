import { BY_KEY, CATALOGUE, type CatalogueTest } from './catalogue.js';
import { cleanUnit, parseUnit, type Unit } from './units.js';

/**
 * "TSH (ICD-9: L69) 1", "Glucose i.P. (SI-Einheit)", "Płytki krwi manualnie (ICD-9: G…" →
 * "tsh", "glucose i p", "plytki krwi manualnie". Lowercase, no diacritics,
 * no lab codes or units in brackets; "%" and "#" kept because they decide
 * between a count and a percentage.
 */
export function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ß/g, 'ss')
    .replace(/\(\s*icd[^)]*\)?/g, ' ')
    .replace(/\((?:si-einheit|konventionell|[a-zµ]+\/[a-z]+)\)/g, ' ')
    .replace(/[^a-z0-9%#]+/g, ' ')
    .replace(/([a-z0-9])([%#])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A mapping learned for a count must not be reused for the percentage with the same name. */
export function nameContextKey(name: string, unit: string | null): string {
  return `${normaliseName(name)}|${unit ? cleanUnit(unit) : ''}`;
}

export interface Match {
  test: CatalogueTest;
  /** 'alias': listed; 'learned': confirmed earlier by the model; 'fuzzy': one or two letters off (OCR). */
  how: 'alias' | 'learned' | 'fuzzy';
}

const ALIASES = new Map<string, CatalogueTest[]>();
for (const test of CATALOGUE) {
  for (const alias of test.aliases) {
    const list = ALIASES.get(alias) ?? [];
    list.push(test);
    ALIASES.set(alias, list);
  }
}

/**
 * Find the catalogue test for a printed name. When a name fits both a count
 * and a percentage ("Neutrofile"), the printed unit decides.
 * `learned` holds names the model mapped before (normalised name → test).
 */
export function matchTest(
  printedName: string,
  printedUnit: string | null,
  learned: ReadonlyMap<string, CatalogueTest> = new Map(),
): Match | null {
  const name = normaliseName(printedName);
  if (!name) return null;
  const unit = parseUnit(printedUnit);

  const exact = candidates(name);
  if (exact.length) return { test: pick(exact, name, unit), how: 'alias' };

  const known = learned.get(nameContextKey(printedName, printedUnit));
  if (known) return { test: known, how: 'learned' };

  // A name cut off at the end of a column: "niedojrzale duze komorki mlode fo".
  if (name.length >= 15) {
    for (const [alias, tests] of ALIASES) {
      if (alias.length > name.length && alias.startsWith(name)) return { test: pick(tests, name, unit), how: 'fuzzy' };
    }
  }

  // OCR slips: "Hsemogłobin", "Hazematocrt". Only for longer names, so "AB" never becomes "AP".
  if (name.replace(/[ %#]/g, '').length >= 6) {
    const limit = name.length >= 9 ? 2 : 1;
    let best: { tests: CatalogueTest[]; d: number } | null = null;
    for (const [alias, tests] of ALIASES) {
      if (alias.length < 5 || Math.abs(alias.length - name.length) > limit) continue;
      const d = distance(alias, name, limit);
      if (d <= limit && (!best || d < best.d)) best = { tests, d };
    }
    if (best) return { test: pick(best.tests, name, unit), how: 'fuzzy' };
  }
  return null;
}

/** Listed aliases for the name, also trying it with "%"/"#" removed. */
function candidates(name: string): CatalogueTest[] {
  const direct = ALIASES.get(name) ?? ALIASES.get(withoutSpecimen(name));
  if (direct) return direct;
  const bare = name.replace(/\s*[%#]$/, '').trim();
  const fromBare = ALIASES.get(bare) ?? [];
  if (!fromBare.length) return [];
  // "Neutrofile %" → the percentage variant of "neutrofile", if there is one.
  const wantsPct = name.endsWith('%');
  const variant = fromBare.flatMap((t) => [BY_KEY.get(`${t.key}-pct`), t]).filter((t): t is CatalogueTest => !!t);
  return wantsPct ? variant.filter((t) => t.unit === '%') : fromBare;
}

/** "erythrozyten i vb" → "erythrozyten": German specimen marks and words that do not change the test. */
function withoutSpecimen(name: string): string {
  let out = name;
  for (;;) {
    const next = out.replace(/\s(?:i (?:vb kb|vb|kb|p|s|u)|im serum|serum|assay|abs|krwi pelnej)$/, '').trim();
    if (next === out) return out;
    out = next;
  }
}

/** Choose between a count and a percentage (or other variants) by the printed unit. */
function pick(tests: CatalogueTest[], name: string, unit: Unit | null): CatalogueTest {
  const all = [...new Set(tests.flatMap((t) => [t, BY_KEY.get(`${t.key}-pct`)].filter((x): x is CatalogueTest => !!x)))];
  if (all.length === 1) return all[0];
  if (name.endsWith('%')) return all.find((t) => t.unit === '%') ?? all[0];
  if (name.endsWith('#')) return all.find((t) => t.unit !== '%') ?? all[0];
  if (unit) {
    const byDim = all.find((t) => parseUnit(t.unit)?.dim === unit.dim);
    if (byDim) return byDim;
  }
  return tests[0];
}

/** Damerau–Levenshtein distance, stopping early above `limit`. */
export function distance(a: string, b: string, limit = Infinity): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > limit) return rowMin;
  }
  return d[a.length][b.length];
}

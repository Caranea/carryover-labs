import { DOMAINS, type CatalogueTest, type Domain } from './catalogue.js';
import type { Pending } from './build-core.js';
import { conversionFactor, parseUnit } from './units.js';

export interface NameAnswer {
  name: string;
  key: string | null;
  newTest: { key: string; label: string; domain: string; unit: string } | null;
  notATest: boolean;
  reason: string;
}

/** Keep a mapping only if it points at a real catalogue test or a well-formed new one. */
export function decideName(a: NameAnswer, tests: CatalogueTest[]): { key: string | null; reason: string; newTest?: CatalogueTest } | null {
  const reason = String(a.reason ?? '').slice(0, 200);
  if (a.notATest) return a.key === null && a.newTest === null ? { key: null, reason: reason || 'Not a lab test name' } : null;
  if (a.key && a.newTest) return null;
  if (a.key && tests.some((t) => t.key === a.key)) return { key: a.key, reason };
  const n = a.newTest;
  if (n && /^[a-z0-9][a-z0-9-]{1,40}$/.test(n.key) && n.label?.trim() && DOMAINS.some((d) => d.key === n.domain)) {
    const existing = tests.find((t) => t.key === n.key);
    if (existing) return { key: existing.key, reason };
    const newTest: CatalogueTest = { key: n.key, label: n.label.trim().slice(0, 60), domain: n.domain as Domain, unit: String(n.unit ?? '').slice(0, 30), aliases: [] };
    return { key: n.key, reason, newTest };
  }
  return null;
}

/** Models cannot authorize numeric conversions; independent unit arithmetic must agree. */
export function validFactor(factor: unknown, c: Pending['conversions'][number]): factor is number {
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0) return false;
  const from = parseUnit(c.from), to = parseUnit(c.to), home = parseUnit(c.test.unit);
  if (!from || !to || !home || conversionFactor(from, home, c.test.molarMass) === null) return false;
  const verified = conversionFactor(from, to, c.test.molarMass);
  return verified !== null && Math.abs(factor - verified) <= Math.abs(verified) * 1e-12;
}

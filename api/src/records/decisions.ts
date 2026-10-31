import { DOMAINS, type CatalogueTest, type Domain } from '../shared/catalogue.js';

export interface NameAnswer {
  name: string;
  key: string | null;
  newTest: { key: string; label: string; domain: string; unit: string } | null;
  notATest: boolean;
  reason: string;
}

/** Keep a mapping only if it points at a real catalogue test or a well-formed new one. */
export function decideName(
  a: NameAnswer,
  tests: CatalogueTest[],
): { key: string | null; reason: string; newTest?: CatalogueTest } | null {
  const reason = String(a.reason ?? '').slice(0, 200);
  if (a.notATest)
    return a.key === null && a.newTest === null
      ? { key: null, reason: reason || 'Not a lab test name' }
      : null;
  if (a.key && a.newTest) return null;
  if (a.key && tests.some((t) => t.key === a.key)) return { key: a.key, reason };
  const n = a.newTest;
  if (
    n &&
    /^[a-z0-9][a-z0-9-]{1,40}$/.test(n.key) &&
    n.label?.trim() &&
    DOMAINS.some((d) => d.key === n.domain)
  ) {
    const existing = tests.find((t) => t.key === n.key);
    if (existing) return { key: existing.key, reason };
    const newTest: CatalogueTest = {
      key: n.key,
      label: n.label.trim().slice(0, 60),
      domain: n.domain as Domain,
      unit: String(n.unit ?? '').slice(0, 30),
      aliases: [],
    };
    return { key: n.key, reason, newTest };
  }
  return null;
}

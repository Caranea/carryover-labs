/**
 * Lab units as dimensions plus a scale, so most conversions need no model and
 * no table: "tys/µl" and "10^9/L" are the same count per litre, "g/dl" is
 * 10 × "g/l", and mass ↔ molar needs only the analyte's molar mass.
 */

export type Dimension =
  | 'mass' // g per litre
  | 'molar' // mol per litre
  | 'count' // cells per litre
  | 'activity' // U or IU per litre (enzymes, hormones in IU)
  | 'percent'
  | 'fraction' // L/L, e.g. haematocrit 0.35
  | 'volume' // fL (MCV, MPV, PDW)
  | 'mass-per-cell' // pg (MCH)
  | 'time' // seconds (prothrombin time)
  | 'rate' // mm/h (ESR)
  | 'gfr' // ml/min/1.73 m²
  | 'clearance' // ml/min without normalization to body surface area
  | 'osmolality'
  | 'titre'
  | 'ratio'; // INR, indices without a unit

export interface Unit {
  dim: Dimension;
  /** Value × scale = value in the dimension's base unit. */
  scale: number;
  /** Canonical spelling for display. */
  label: string;
}

const PREFIX: Record<string, number> = { '': 1, k: 1e3, d: 1e-1, c: 1e-2, m: 1e-3, µ: 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };

/** Normalise the many printed spellings: "µIU/ml*", "uIU/mL", "tys/ul", "x 10*9/L", "10^9/l". */
export function cleanUnit(raw: string): string {
  return raw
    .trim()
    .replace(/^\[|\]$/g, '')
    .replace(/[*\s]+$/g, '')
    .toLowerCase()
    .replace(/μ/g, 'µ')
    .replace(/^x\s*/, '')
    .replace(/10\s*(?:\^|\*|e|x)\s*(\d+)/, '10^$1')
    .replace(/10([⁰¹²³⁴⁵⁶⁷⁸⁹]+)/, (_, d: string) => '10^' + [...d].map((c) => '⁰¹²³⁴⁵⁶⁷⁸⁹'.indexOf(c)).join(''))
    .replace(/\s+/g, '')
    .replace(/^mcg/, 'µg')
    .replace(/^u(?=g\/|mol\/|iu\/)/, 'µ')
    .replace(/\/ul$/, '/µl')
    .replace(/\/mm3$/, '/µl');
}

export function parseUnit(raw: string | null | undefined): Unit | null {
  if (!raw) return null;
  const u = cleanUnit(raw);
  if (!u) return null;
  if (u === 'mosm/kg') return { dim: 'osmolality', scale: 0.001, label: 'mOsm/kg' };
  if (u === 'osm/kg') return { dim: 'osmolality', scale: 1, label: 'Osm/kg' };
  if (u === '%') return { dim: 'percent', scale: 1, label: '%' };
  if (u === 'l/l') return { dim: 'fraction', scale: 1, label: 'L/L' };
  if (u === 'fl') return { dim: 'volume', scale: 1, label: 'fL' };
  if (u === 'pg') return { dim: 'mass-per-cell', scale: 1, label: 'pg' };
  if (u === 's' || u === 'sek' || u === 'sec' || u === 'sek.') return { dim: 'time', scale: 1, label: 's' };
  if (u === 'mm/h' || u === 'mm/godz' || u === 'mm/hr' || u === 'mm/1h') return { dim: 'rate', scale: 1, label: 'mm/h' };
  if (u === 'ml/min') return { dim: 'clearance', scale: 1, label: 'ml/min' };
  if (/^ml\/min\/1[.,]73(m2|m²)?$/.test(u)) return { dim: 'gfr', scale: 1, label: 'ml/min/1.73m²' };
  if (u === 'titre' || u === 'titer' || u === 'miano') return { dim: 'titre', scale: 1, label: 'titre' };
  if (u === 'inr' || u === 'ratio' || u === 'index' || u === 'idx') return { dim: 'ratio', scale: 1, label: 'ratio' };

  const m = /^(.*)\/(k|d|c|m|µ|n|p|f)?l$/.exec(u);
  if (!m) return null;
  const [, num, volPrefix = ''] = m;
  const volume = PREFIX[volPrefix];
  const per = (dim: Dimension, amount: number, label: string): Unit => ({ dim, scale: amount / volume, label });
  const volLabel = { '': 'L', d: 'dL', c: 'cL', m: 'mL', µ: 'µL', n: 'nL', p: 'pL', f: 'fL', k: 'kL' }[volPrefix];

  // Counts: "tys", "mln", "10^9", "g"/"gpt" (giga), "t"/"tpt" (tera), a bare "/µl".
  // "G/l" (giga per litre) is ambiguous with grams per litre; see `asCount`.
  const count: Record<string, number> = { tys: 1e3, 'tys.': 1e3, tyś: 1e3, tsd: 1e3, 'tsd.': 1e3, mln: 1e6, 'mln.': 1e6, mio: 1e6, 'mio.': 1e6, gpt: 1e9, t: 1e12, tpt: 1e12, '': 1 };
  if (num in count) return countUnit(count[num] / volume);
  const pow = /^10\^(\d{1,2})$/.exec(num);
  if (pow) return countUnit(10 ** Number(pow[1]) / volume);

  const mass = /^(k|m|µ|n|p|f)?g$/.exec(num);
  if (mass) return per('mass', PREFIX[mass[1] ?? ''], `${mass[1] ?? ''}g/${volLabel}`);
  const molar = /^(m|µ|n|p|f)?mol$/.exec(num);
  if (molar) return per('molar', PREFIX[molar[1] ?? ''], `${molar[1] ?? ''}mol/${volLabel}`);
  const activity = /^(k|m|µ)?i?u$/.exec(num);
  if (activity) return per('activity', PREFIX[activity[1] ?? ''], `${activity[1] ?? ''}${num.includes('i') ? 'IU' : 'U'}/${volLabel}`);
  return null;
}

/** German "G/l" means 10^9 cells per litre when the test is a cell count. */
export function asCount(unit: Unit, raw: string): Unit {
  return unit.dim === 'mass' && cleanUnit(raw) === 'g/l' ? countUnit(1e9) : unit;
}

/** Counts are shown as 10^9/L or 10^12/L, the international spelling. */
function countUnit(perLitre: number): Unit {
  const exp = Math.round(Math.log10(perLitre));
  return { dim: 'count', scale: perLitre, label: exp > 0 ? `10^${exp}/L` : '/L' };
}

/**
 * Factor to multiply a value in `from` to get it in `to`, or null when the
 * units do not convert without more knowledge. Mass ↔ molar needs the molar mass.
 */
export function conversionFactor(from: Unit, to: Unit, molarMass?: number): number | null {
  if (from.dim === to.dim) return from.scale / to.scale;
  if (from.dim === 'percent' && to.dim === 'fraction') return 0.01;
  if (from.dim === 'fraction' && to.dim === 'percent') return 100;
  if (molarMass) {
    if (from.dim === 'molar' && to.dim === 'mass') return (from.scale * molarMass) / to.scale;
    if (from.dim === 'mass' && to.dim === 'molar') return from.scale / molarMass / to.scale;
  }
  return null;
}

/** Same dimension: the values can share an axis after conversion. */
export function sameDimension(a: Unit | null, b: Unit | null): boolean {
  return !!a && !!b && a.dim === b.dim;
}

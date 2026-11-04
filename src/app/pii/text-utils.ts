export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Parse common date spellings (31.12.1990, 1990-12-31, 31/12/1990, 31-12-1990)
 * into YYYY-MM-DD. Day-first is assumed for dotted and slashed forms.
 */
export function parseDate(raw: string): string | null {
  const s = raw.replace(/[,;]$/, '');
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(s);
  if (m) return iso(+m[3], +m[2], +m[1]);
  return null;
}

function iso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function isDateToken(raw: string): boolean {
  return parseDate(raw) !== null;
}

// Scores a Muse Spark transcription against a hand-checked ground truth, row by row.
// Pure functions: no model calls, no files. Used by check-pipeline-models.mjs.

/** "Glucose i.P. (SI-Einheit)" and "glucose i. p. (si-einheit)" are the same printed name. */
export function sameName(a, b) {
  const fold = (s) =>
    (s ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9%]+/g, '');
  return fold(a) === fold(b);
}

/** Compare values as printed: "<0,6" = "< 0.6"; a trailing flag ("130 -", "4.1H") is not the value. */
export function sameValue(a, b) {
  const fold = (s) =>
    (s ?? '')
      .replace(/\s+/g, '')
      .replace(',', '.')
      .replace(/(?<=\d)(HH|LL|[HL↑↓*!+-])$/, '');
  return fold(a) === fold(b);
}

/** "mmol/l" = "mmol/L", "µmol/l" = "umol/l"; "[-]", "-" and nothing are all no unit. */
export function sameUnit(a, b) {
  const fold = (s) => {
    const t = (s ?? '')
      .replace(/[[\]\s]/g, '')
      .toLowerCase()
      .replace(/[µμ]/g, 'u');
    return /^-*$/.test(t) ? '' : t;
  };
  return fold(a) === fold(b);
}

/**
 * Match every truth row to at most one transcribed row by name, then score each field.
 * Extra rows (a heading read as a row, a duplicated line) are counted separately.
 */
export function score(truth, rows) {
  const used = new Set();
  const perRow = truth.map((t) => {
    const i = rows.findIndex((r, j) => !used.has(j) && sameName(r.name, t.name));
    if (i < 0) return { name: t.name, found: false };
    used.add(i);
    const r = rows[i];
    return {
      name: t.name,
      found: true,
      value: sameValue(r.value, t.value),
      unit: sameUnit(r.unit, t.unit),
      doubt: !!r.doubt,
      printed: r.value,
    };
  });
  const count = (f) => perRow.filter(f).length;
  return {
    truthRows: truth.length,
    returnedRows: rows.length,
    namesFound: count((r) => r.found),
    valuesCorrect: count((r) => r.found && r.value),
    unitsCorrect: count((r) => r.found && r.unit),
    markedDoubtful: count((r) => r.found && r.doubt),
    extraRows: rows.length - used.size,
    wrongValues: perRow
      .filter((r) => r.found && !r.value)
      .map((r) => ({ name: r.name, printed: r.printed })),
    missing: perRow.filter((r) => !r.found).map((r) => r.name),
  };
}

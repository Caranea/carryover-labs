/** Round axis bounds and 3–5 ticks. */
export function niceScale(min: number, max: number): { lo: number; hi: number; ticks: number[] } {
  const nonNegative = min >= 0;
  if (min === max) {
    const pad = Math.abs(min) * 0.2 || 1;
    min -= pad;
    max += pad;
  }
  const span = max - min;
  const raw = span / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  let lo = Math.floor((min - span * 0.08) / step) * step;
  const hi = Math.ceil((max + span * 0.08) / step) * step;
  if (lo < 0 && nonNegative) lo = 0; // lab values never go below zero
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(10)));
  return { lo, hi, ticks };
}

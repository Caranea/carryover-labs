import type { Observation } from '../shared/results.js';

const fold = (text: string) => text.trim().replace(/\s+/g, ' ').toLowerCase();

type Form = 'free' | 'total' | 'ionized' | 'direct' | 'indirect';

/**
 * The printed form of a test that must not share a line with another form: ionized and total
 * calcium differ by about half, direct and total bilirubin by much more.
 */
export function namedForm(name: string): Form | null {
  const t = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
  if (/\b(free|frei|freies|woln[ay])\b/.test(t)) return 'free';
  if (/(ioni[sz]\w*|zjonizowan\w*)/.test(t)) return 'ionized';
  if (
    /(^|[^a-z])(indirect|indirekt\w*|posredni\w*|nieskoniugowan\w*|unconjugated)([^a-z]|$)/.test(t)
  )
    return 'indirect';
  if (/(^|[^a-z])(direct|direkt\w*|bezposredni\w*|skoniugowan\w*|conjugated)([^a-z]|$)/.test(t))
    return 'direct';
  if (/\b(total|gesamt|calkowit[ay])\b/.test(t)) return 'total';
  return null;
}

/** The body fluid of a row: from its printed specimen (or its English), else its section. */
export function fluidOf(o: Observation, english?: Map<string, string>): string | null {
  const specimen = o.transcription?.specimen;
  const section = o.transcription?.section;
  return (
    (specimen ? specimenClass(english?.get(fold(specimen)) || specimen) : null) ??
    (section ? specimenClass(section) : null)
  );
}

/**
 * Blood, serum, plasma and an anticoagulant tube are the default and share a line; another
 * body fluid is named ("urine"). Reads the English translation, or the printed text.
 */
export function specimenClass(text: string): string | null {
  const t = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
  // Whole words only: "Harnstoff", "Mocznik" (urea) and "Kalium" (potassium) are blood tests,
  // not urine or stool. "Harn", "Spontanharn", "mocz", "moczu", "kał" and "kału" are fluids.
  if (/(^|[^a-z])(urin\w*|mocz|moczu|harn|\w+harn)([^a-z]|$)/.test(t)) return 'urine';
  if (/(^|[^a-z])(csf|cerebrospinal|liquor|mozgowo\w*)/.test(t)) return 'CSF';
  if (/(^|[^a-z])(stool|faec\w*|fec\w*|kal|kalu|stuhl)([^a-z]|$)/.test(t)) return 'stool';
  if (/\b(saliva|slina|speichel)/.test(t)) return 'saliva';
  if (/\b(synovial|pleural|ascit|peritoneal|maziowy|oplucnow|otrzewnow)/.test(t))
    return 'body fluid';
  return null;
}

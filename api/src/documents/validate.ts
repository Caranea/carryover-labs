import { PII_KINDS, SOURCE_KINDS, type DocumentManifest, type StoredPage, type StoredWord, type Tuple4 } from './contract.js';
import { storedMaskGeometry } from './mask-geometry.js';

export const LIMITS = {
  pages: 40,
  wordsPerPage: 20_000,
  regionsPerPage: 500,
  wordLength: 200,
  nameLength: 120,
  side: 10_000,
  imageBytes: 8 * 1024 * 1024,
  manifestBytes: 6 * 1024 * 1024,
  uploadBytes: 40 * 1024 * 1024,
  imagePixels: 25_000_000,
};

export class ManifestError extends Error {}

/**
 * Strictly check an uploaded manifest and rebuild it from known fields only,
 * so nothing unexpected (for example detection details or original text)
 * can be stored by accident.
 */
export function parseManifest(raw: unknown): DocumentManifest {
  if (typeof raw !== 'string' || !raw) throw new ManifestError('The document description is missing.');
  if (raw.length > LIMITS.manifestBytes) throw new ManifestError('The document is too large.');
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ManifestError('The document description is not valid.');
  }
  const m = obj(data, 'document');

  const name = str(m['name'], 'name').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, LIMITS.nameLength);
  if (/@|\b\d[\d\s-]{6,}\b/.test(name)) throw new ManifestError('Use a general document name without personal details.');
  const sourceKind = m['sourceKind'];
  if (!SOURCE_KINDS.includes(sourceKind as never)) throw new ManifestError('Unknown source type.');

  const pagesRaw = m['pages'];
  if (!Array.isArray(pagesRaw) || !pagesRaw.length) throw new ManifestError('The document has no pages.');
  if (pagesRaw.length > LIMITS.pages) throw new ManifestError(`Documents can have at most ${LIMITS.pages} pages.`);
  const pages = pagesRaw.map((p, i) => parsePage(p, i));

  return {
    name: name || 'Document',
    sourceKind: sourceKind as DocumentManifest['sourceKind'],
    pages,
    hiddenCount: countHidden(pages),
  };
}

function parsePage(raw: unknown, i: number): StoredPage {
  const p = obj(raw, `page ${i + 1}`);
  if (p['index'] !== i) throw new ManifestError('Pages are out of order.');
  const width = int(p['width'], 0, LIMITS.side, 'page width');
  const height = int(p['height'], 0, LIMITS.side, 'page height');
  const hasImage = p['hasImage'] === true;
  if (hasImage && (!width || !height)) throw new ManifestError('A page image has no size.');

  const wordsRaw = p['words'];
  if (!Array.isArray(wordsRaw) || wordsRaw.length > LIMITS.wordsPerPage) throw new ManifestError('Too many words on a page.');
  const regionsRaw = p['regions'] ?? [];
  if (!Array.isArray(regionsRaw) || regionsRaw.length > LIMITS.regionsPerPage) throw new ManifestError('Too many hidden areas on a page.');

  const words = wordsRaw.map(parseWord);
  const regions = regionsRaw.map((r) => tuple(r));
  if (!hasImage && regions.length) throw new ManifestError('Hidden areas require a page image.');
  for (const box of [...regions, ...words.flatMap((w) => w.b ? [w.b] : [])]) {
    if (box[0] < 0 || box[1] < 0 || box[2] <= 0 || box[3] <= 0 || box[0] + box[2] > width + 1 || box[1] + box[3] > height + 1) {
      throw new ManifestError('A hidden area or word lies outside its page.');
    }
  }
  for (const word of words) {
    if (hasImage && word.h && !word.b) throw new ManifestError('A hidden word has no position on its page.');
  }
  const masks = storedMaskGeometry({ width, height, words, regions });
  if ([...masks.hidden].some((index) => !words[index].h)) throw new ManifestError('Text underneath a hidden area must also be removed. Review the final hidden areas and retry.');

  return {
    index: i,
    width,
    height,
    hasImage,
    ocr: p['ocr'] === true,
    words,
    regions,
  };
}

function parseWord(raw: unknown): StoredWord {
  const w = obj(raw, 'word');
  const hidden = w['h'] === true;
  const t = w['t'];
  if (hidden && t !== null) throw new ManifestError('A hidden word still has its text.');
  if (!hidden && (typeof t !== 'string' || !t || t.length > LIMITS.wordLength)) {
    throw new ManifestError('A word is not valid.');
  }
  const word: StoredWord = { t: hidden ? null : (t as string), l: int(w['l'], 0, 1_000_000, 'line') };
  if (w['b'] !== undefined) word.b = tuple(w['b']);
  if (hidden) {
    word.h = true;
    if (PII_KINDS.includes(w['k'] as never)) word.k = w['k'] as StoredWord['k'];
  }
  return word;
}

export function countHidden(pages: StoredPage[]): number {
  return pages.reduce((n, p) => n + p.words.filter((w) => w.h).length + p.regions.length, 0);
}

/**
 * A saved document may gain hidden words when it is saved again, never lose
 * them: everything removed before must still be removed.
 */
export function assertOnlyMoreHidden(previous: StoredPage[], next: StoredPage[]): void {
  const msg = 'Words that were removed before cannot be shown again.';
  if (previous.length !== next.length) throw new ManifestError(msg);
  previous.forEach((old, i) => {
    const page = next[i];
    if (old.words.length !== page.words.length || old.hasImage !== page.hasImage || old.width !== page.width || old.height !== page.height) throw new ManifestError(msg);
    old.words.forEach((w, j) => {
      const nextWord = page.words[j];
      if (w.h && !nextWord.h) throw new ManifestError(msg);
      if (w.l !== nextWord.l || JSON.stringify(w.b) !== JSON.stringify(nextWord.b)) throw new ManifestError('The source word positions cannot change when hiding more details.');
      if (!nextWord.h && w.t !== nextWord.t) throw new ManifestError('Source text cannot change when hiding more details.');
    });
    if (page.regions.length < old.regions.length) throw new ManifestError(msg);
    old.regions.forEach((r, j) => {
      if (r.some((v, k) => v !== page.regions[j][k])) throw new ManifestError(msg);
    });
  });
}

const PESEL_WEIGHTS = [1, 3, 7, 9, 1, 3, 7, 9, 1, 3];

export function isValidPesel(digits: string): boolean {
  if (!/^\d{11}$/.test(digits)) return false;
  const sum = PESEL_WEIGHTS.reduce((s, w, i) => s + w * Number(digits[i]), 0);
  return (10 - (sum % 10)) % 10 === Number(digits[10]);
}

/** PESEL encodes the birth date: month 01–12 plus 20/40/60/80 for the century, day 01–31. */
function hasPlausibleBirthDate(d: string): boolean {
  const month = Number(d.slice(2, 4)) % 20;
  const day = Number(d.slice(4, 6));
  return month >= 1 && month <= 12 && day >= 1 && day <= 31;
}

export function isLikelyPesel(digits: string): boolean {
  return isValidPesel(digits) && hasPlausibleBirthDate(digits);
}

/**
 * Last line of defence: refuse a document whose visible text still contains a
 * PESEL number. Returns the 1-based page number, or null.
 */
export function findVisiblePesel(pages: StoredPage[]): number | null {
  for (const page of pages) {
    const visible = page.words.filter((w) => w.t !== null);
    for (let i = 0; i < visible.length; i++) {
      // Also catch a number split by OCR into up to three pieces of plain digits on one line.
      let joined = '';
      for (let j = i; j < Math.min(i + 3, visible.length) && visible[j].l === visible[i].l; j++) {
        const core = (visible[j].t as string).replace(/^\p{L}+[:.]?/u, '');
        if (!/^\d+$/.test(core.replace(/-/g, ''))) break;
        joined += core.replace(/\D/g, '');
        if (joined.length > 11) break;
        if (joined.length === 11 && isLikelyPesel(joined)) return page.index + 1;
      }
    }
  }
  return null;
}

export function isJpeg(buf: Buffer): boolean {
  return buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function obj(v: unknown, what: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new ManifestError(`The ${what} is not valid.`);
  return v as Record<string, unknown>;
}

function str(v: unknown, what: string): string {
  if (typeof v !== 'string') throw new ManifestError(`The ${what} is not valid.`);
  return v;
}

function int(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new ManifestError(`The ${what} is not valid.`);
  }
  return v;
}

function tuple(v: unknown): Tuple4 {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 100_000)) {
    throw new ManifestError('A box is not valid.');
  }
  return [Math.round(v[0]), Math.round(v[1]), Math.round(v[2]), Math.round(v[3])];
}

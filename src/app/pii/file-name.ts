import { digitsOnly, isDateToken } from './text-utils';

/**
 * A title with personal parts replaced: long numbers such as an ID or a record number.
 * Anything else in a title you typed stays as you typed it.
 */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/\.[^.]+$/, '');
  const parts = base.split(/([_\-\s.]+)/);
  const cleaned = parts.map((p) => {
    if (/^[_\-\s.]+$/.test(p) || !p) return p;
    const digits = digitsOnly(p);
    if (digits.length >= 7 && !isDateToken(p)) return '▇▇▇';
    return p;
  });
  const result = cleaned.join('').trim();
  return result || 'Document';
}

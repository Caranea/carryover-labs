import { sanitizeFileName } from './file-name';

describe('document names', () => {
  it('keeps an ordinary name', () => {
    expect(sanitizeFileName('Thyroid tests.pdf')).toBe('Thyroid tests');
  });

  it('replaces long numbers but keeps dates', () => {
    expect(sanitizeFileName('Wyniki_97010112345.pdf')).toBe('Wyniki_▇▇▇');
    expect(sanitizeFileName('Wyniki 31.12.2025.pdf')).toBe('Wyniki 31.12.2025');
  });
});

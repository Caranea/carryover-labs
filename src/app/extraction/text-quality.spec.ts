import { textLayerIsUsable, textQuality } from './text-quality';

describe('textLayerIsUsable', () => {
  it('accepts a normal lab report text layer', () => {
    const text = `Morfologia krwi Leukocyty 5,3 tys/µl 4,0 10,0 Erytrocyty 4,6 mln/µl 4,1 5,1
      Hemoglobina 12,9 g/dl 12,1 15,1 Data pobrania: 2014-02-09 Płytki krwi 98 tys/µl 180 430 L`;
    expect(textLayerIsUsable(text)).toBe(true);
  });

  it('rejects text from fonts without a character map', () => {
    const text = `! " #$ %&' ( ) *+ * , '# + -. ////////0 !" # $%" &' '(! )%#* 1 0 // 2 . 3' 4. + -% + *.* 5/ 6`;
    expect(textLayerIsUsable(text)).toBe(false);
  });

  it('rejects shifted characters even when some lines are readable', () => {
    const text = `Diagnostyka Sp. z o.o XOSURI0LFKDáDĩ\\F]NRZVNLHJR.UDNyZHPDLOODE#GLDJSO
      0('<&=1(/$%25$725,80',$*1267<.$QUNVLĊJLUHMHVWURZHM3RGPLRWX/HF]QLF]HJR6]SLWDOQD
      WYNIK BADANIA GRUPY KRWI NIEPOTWIERDZONY Data rej.: 2019-02-16 12:29:45 Kontrahent: %$'$1,$3à$71(
      2GG]LDá 3XQNW3REUDĔ6]SLWDO 'DWDJRG]SU]\\MĊFLDSUyENLGREDGDĔ 1D]ZLVNRLLPLĊ 3áHü`;
    expect(textQuality(text).weird).toBeGreaterThan(0.08);
    expect(textLayerIsUsable(text)).toBe(false);
  });

  it('rejects pages with almost no text (scans)', () => {
    expect(textLayerIsUsable('  ')).toBe(false);
  });
});

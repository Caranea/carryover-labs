import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertOnlyMoreHidden, findVisiblePesel, ManifestError, parseManifest } from './validate.js';

const page = (words: unknown[], extra: Record<string, unknown> = {}) => ({
  index: 0, width: 100, height: 100, hasImage: true, ocr: false, words, regions: [], ...extra,
});
const manifest = (pages: unknown[]) => JSON.stringify({ name: 'Morfologia', sourceKind: 'image', pages, hiddenCount: 999 });

describe('parseManifest', () => {
  it('keeps only known fields and recounts hidden words', () => {
    const m = parseManifest(
      manifest([page([{ t: 'PLT', l: 0, b: [1, 2, 3, 4], extra: 'x' }, { t: null, h: true, k: 'person', l: 0, b: [10, 2, 3, 4], source: 'model' }])]),
    );
    assert.equal(m.hiddenCount, 1);
    assert.deepEqual(m.pages[0].words, [{ t: 'PLT', l: 0, b: [1, 2, 3, 4] }, { t: null, l: 0, b: [10, 2, 3, 4], h: true, k: 'person' }]);
  });

  it('rejects a hidden word that still carries text', () => {
    assert.throws(() => parseManifest(manifest([page([{ t: 'Kowalska', h: true, l: 0 }])])), ManifestError);
  });

  it('rejects pages out of order and bad JSON', () => {
    assert.throws(() => parseManifest(manifest([page([], { index: 3 })])), ManifestError);
    assert.throws(() => parseManifest('{nope'), ManifestError);
  });

  it('rejects covered visible text, out-of-bounds masks and hidden image words without positions', () => {
    assert.throws(() => parseManifest(manifest([page([{ t: 'Name', l: 0, b: [5, 5, 10, 10] }], { regions: [[0, 0, 20, 20]] })])), /underneath/);
    assert.throws(() => parseManifest(manifest([page([], { regions: [[-1, 0, 20, 20]] })])), /outside/);
    assert.throws(() => parseManifest(manifest([page([{ t: null, h: true, l: 0 }])])), /position/);
  });

  it('rejects text reached through neighbouring word masks, including the final edge pixel', () => {
    assert.throws(() => parseManifest(manifest([page([
      { t: null, h: true, l: 0, b: [10, 10, 10, 10] },
      { t: null, h: true, l: 0, b: [22, 10, 10, 10] },
      { t: 'must also be removed', l: 0, b: [34, 10, 10, 10] },
    ])])), /underneath/);
  });
});

describe('findVisiblePesel', () => {
  const stored = (texts: string[]) => [{ index: 0, width: 0, height: 0, hasImage: false, ocr: false, regions: [], words: texts.map((t) => ({ t, l: 0 })) }];

  it('finds a whole or split PESEL', () => {
    assert.equal(findVisiblePesel(stored(['PESEL:', '44051401359'])), 1);
    assert.equal(findVisiblePesel(stored(['440514', '01359'])), 1);
  });

  it('ignores lab values and wrong checksums', () => {
    assert.equal(findVisiblePesel(stored(['44051401358'])), null);
    assert.equal(findVisiblePesel(stored(['Hemoglobina', '13,2', 'g/dl', '12,0', '16,0'])), null);
  });
});

describe('assertOnlyMoreHidden', () => {
  const p = (hidden: boolean[]) => [{ index: 0, width: 1, height: 1, hasImage: true, ocr: false, regions: [], words: hidden.map((h) => (h ? { t: null, l: 0, h: true as const } : { t: 'a', l: 0 })) }];

  it('allows hiding more and refuses showing again', () => {
    assert.doesNotThrow(() => assertOnlyMoreHidden(p([true, false]), p([true, true])));
    assert.throws(() => assertOnlyMoreHidden(p([true, false]), p([false, false])), ManifestError);
  });

  it('rejects moving hidden masks or rewriting visible source evidence', () => {
    const old = p([true, false]);
    const moved = structuredClone(old);
    moved[0].width = 2;
    assert.throws(() => assertOnlyMoreHidden(old, moved), ManifestError);
    const changed = structuredClone(old);
    changed[0].words[1].t = 'different';
    assert.throws(() => assertOnlyMoreHidden(old, changed), /Source text/);
  });
});

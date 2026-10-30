import assert from 'node:assert/strict';
import { it } from 'node:test';
import { maskGeometry, storedMaskGeometry } from './mask-geometry.js';

it('does not turn padding into a chain of unrelated masks', () => {
  const words = [10, 22, 34, 50].map((x, index) => ({ hidden: index === 0, box: { x, y: 10, w: 10, h: 10 } }));
  const plan = maskGeometry(100, 80, words, []);
  assert.deepEqual([...plan.hidden], [0]);
  assert.deepEqual([...plan.origins.values()], [0]);
  assert.deepEqual(plan.boxes[0], { x: 8, y: 8, w: 14, h: 15 });
  const stored = storedMaskGeometry({ width: 100, height: 80, regions: [], words: words.map((word, index) => ({ h: plan.hidden.has(index), b: [word.box.x, word.box.y, word.box.w, word.box.h] })) });
  assert.deepEqual(stored.boxes, plan.boxes);
  words[0].hidden = false;
  assert.equal(maskGeometry(100, 80, words, []).hidden.size, 0);
});

it('clips fractional edge masks and adds the edge pixel only once', () => {
  const plan = maskGeometry(100, 80, [{ hidden: false, box: { x: 10.4, y: 10, w: 10, h: 10 } }], [{ x: 0.6, y: 10, w: 9.8, h: 10 }, { x: 98.7, y: 78.7, w: 6, h: 7 }]);
  assert.deepEqual(plan.regionBoxes, [{ x: 1, y: 10, w: 11, h: 11 }, { x: 99, y: 79, w: 1, h: 1 }]);
  assert.equal(plan.hidden.has(0), true);
  assert.equal(plan.origins.get(0), -1);
});

it('handles 20,000 words in reversed chains without repeated whole-page scans', { timeout: 5000 }, (t) => {
  const words = Array.from({ length: 20_000 }, (_, index) => ({ hidden: index % 1000 === 0, box: { x: (index % 1000) * 10, y: Math.floor(index / 1000) * 20, w: 11, h: 8 } })).reverse();
  const start = performance.now();
  const plan = maskGeometry(10_000, 500, words, []);
  t.diagnostic(`20,000-word closure: ${Math.round(performance.now() - start)} ms`);
  assert.equal(plan.hidden.size, 20_000);
  assert.equal(plan.boxes.length, 20_000);
});

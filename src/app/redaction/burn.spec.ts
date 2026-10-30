import { LocalDocument, WorkingPage } from '../core/models';
import { applyRegion, boxesToBurn, buildManifest, redactionAction, redactionPlan, removeRegion, toStoredPage } from './burn';
import { storedMaskGeometry } from '../../../api/src/documents/mask-geometry';

const page = (): WorkingPage => ({
  index: 0,
  width: 1000,
  height: 800,
  image: null,
  imageUrl: null,
  ocr: true,
  regions: [],
  words: [
    { id: 0, text: 'Pacjent:', line: 0, hidden: false, box: { x: 10, y: 10, w: 80, h: 20 } },
    { id: 1, text: 'Kowalska', line: 0, hidden: true, kind: 'person', source: 'model', score: 0.9, box: { x: 100, y: 10, w: 90, h: 20 } },
    { id: 2, text: 'PLT', line: 1, hidden: false, box: { x: 10, y: 50, w: 40, h: 20 } },
  ],
});

describe('upload contract', () => {
  it('never includes the text of hidden words', () => {
    const stored = toStoredPage(page());
    expect(stored.words[1]).toEqual({ t: null, b: [100, 10, 90, 20], l: 0, h: true, k: 'person' });
    expect(JSON.stringify(stored)).not.toContain('Kowalska');
    // Detection details stay on the device.
    expect(JSON.stringify(stored)).not.toContain('model');
  });

  it('counts hidden words and drawn areas in the manifest', () => {
    const p = applyRegion(page(), { x: 0, y: 45, w: 60, h: 30 });
    const doc = { sourceKind: 'image', pages: [p] } as unknown as LocalDocument;
    const manifest = buildManifest(doc, 'Morfologia');
    expect(manifest.hiddenCount).toBe(3); // Kowalska, PLT (under the box), the box itself
    expect(manifest.pages[0].regions).toEqual([[0, 45, 60, 30]]);
    expect(manifest.pages[0].words[2].t).toBeNull();
  });

  it('pads boxes so OCR boxes that hug the letters are fully covered', () => {
    const [box] = boxesToBurn(page());
    expect(box.x).toBeLessThan(100);
    expect(box.x + box.w).toBeGreaterThan(190);
    expect(box.y).toBeLessThan(10);
  });

  it('never uploads text underneath a region even if a stale Keep action reset the word', () => {
    const p = page();
    p.regions = [{ x: 95, y: 5, w: 100, h: 30 }];
    p.words[1].hidden = false;
    const stored = toStoredPage(p);
    expect(stored.words[1].h).toBe(true);
    expect(JSON.stringify(stored)).not.toContain('Kowalska');
  });

  it('uses matching integer geometry at fractional pixel boundaries', () => {
    const p = page();
    p.words = [{ id: 0, text: 'private', line: 0, hidden: false, box: { x: 10.4, y: 10, w: 10, h: 10 } }];
    p.regions = [{ x: 0.6, y: 10, w: 9.8, h: 10 }];
    // Raw boxes only touch, but transmitted pixel boxes overlap: the text must be omitted.
    expect(toStoredPage(p).words[0].t).toBeNull();
  });

  it('stops padding at neighbours and uses identical preview, payload and server masks', () => {
    const p = page();
    p.words = [10, 22, 34, 50].map((x, id) => ({ id, text: `word${id}`, line: 0, hidden: id === 0, box: { x, y: 10, w: 10, h: 10 } }));
    const plan = redactionPlan(p);
    const stored = toStoredPage(p);
    expect(stored.words.map((word) => word.t)).toEqual([null, 'word1', 'word2', 'word3']);
    expect(plan.boxes).toEqual(boxesToBurn(p));
    expect(storedMaskGeometry(stored).boxes).toEqual(plan.boxes);
    expect(redactionAction(p, 0, plan)).toEqual({ wordId: 0 });
    p.words[0].locked = true;
    expect(redactionAction(p, 0, plan)).toBeNull();
    p.words[0].locked = false;
    p.words[0].hidden = false;
    expect(redactionPlan(p).hidden.size).toBe(0);
    expect(toStoredPage(p).words.every((word) => word.t !== null)).toBe(true);
  });

  it('keeps dates touching an ID box readable, while burning the complete ID', () => {
    const p = page();
    p.width = 1958; p.height = 2600;
    p.words = [
      { id: 0, text: '14-Jul-2012', line: 0, hidden: false, box: { x: 527, y: 2269, w: 159, h: 43 } },
      { id: 1, text: '123123123', line: 1, hidden: true, box: { x: 523, y: 2312, w: 159, h: 27 } },
      { id: 2, text: '14-Jul-2012', line: 2, hidden: false, box: { x: 520, y: 2391, w: 171, h: 28 } },
    ];
    const stored = toStoredPage(p), plan = redactionPlan(p);
    expect(stored.words.map(w => w.t)).toEqual(['14-Jul-2012', null, '14-Jul-2012']);
    expect(plan.boxes[0].y).toBe(2312);
    expect(plan.boxes[0].x).toBeLessThanOrEqual(523);
    expect(plan.boxes[0].x + plan.boxes[0].w).toBeGreaterThanOrEqual(682);
    expect(plan.boxes[0].y + plan.boxes[0].h).toBeGreaterThanOrEqual(2339);
    expect(storedMaskGeometry(stored).boxes).toEqual(plan.boxes);
  });

  it('still removes text that overlaps the actual identity box or a drawn region', () => {
    const p = page();
    p.words = [10, 18, 26].map((x, id) => ({ id, text: `private${id}`, line: 0, hidden: id === 0, box: { x, y: 10, w: 10, h: 10 } }));
    const stored = toStoredPage(p);
    expect(stored.words.every(w => w.t === null)).toBe(true);
    expect(storedMaskGeometry(stored).boxes).toEqual(redactionPlan(p).boxes);
  });

  it('undoes a drawn area without making its covered words new hiding choices', () => {
    const original = page();
    const drawn = applyRegion(original, { x: 0, y: 45, w: 60, h: 30 });
    expect(toStoredPage(drawn).words[2].t).toBeNull();
    expect(drawn.words[2].hidden).toBe(false);
    expect(redactionAction(drawn, 2)).toEqual({ regionIndex: 0 });
    const undone = removeRegion(drawn, 0);
    expect(toStoredPage(undone).words[2].t).toBe('PLT');
    expect(toStoredPage(undone).words[1].t).toBeNull(); // explicit earlier choice remains
  });
});

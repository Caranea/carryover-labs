import { WorkingPage } from '../core/models';
import { turnBox, turnPageGeometry } from './rotate';

const page: WorkingPage = {
  index: 0,
  width: 300,
  height: 200,
  image: null,
  imageUrl: null,
  ocr: true,
  words: [{ id: 0, text: 'Doe', box: { x: 10, y: 20, w: 30, h: 5 }, line: 0, hidden: true }],
  regions: [{ x: 250, y: 150, w: 40, h: 40 }],
};

describe('turning a page', () => {
  it('moves a box with the page: the top-left corner goes top-right on a clockwise turn', () => {
    expect(turnBox({ x: 0, y: 0, w: 10, h: 20 }, 300, 200, 1)).toEqual({
      x: 180,
      y: 0,
      w: 20,
      h: 10,
    });
    expect(turnBox({ x: 0, y: 0, w: 10, h: 20 }, 300, 200, -1)).toEqual({
      x: 0,
      y: 290,
      w: 20,
      h: 10,
    });
  });

  it('swaps the size and keeps words and drawn areas covered', () => {
    const turned = turnPageGeometry(page, 1);
    expect([turned.width, turned.height]).toEqual([200, 300]);
    expect(turned.words[0]).toMatchObject({
      text: 'Doe',
      hidden: true,
      box: { x: 175, y: 10, w: 5, h: 30 },
    });
    expect(turned.regions[0]).toEqual({ x: 10, y: 250, w: 40, h: 40 });
  });

  it('comes back unchanged after a full turn either way, and after a turn and its reverse', () => {
    let clockwise = page;
    let counter = page;
    for (let i = 0; i < 4; i++) {
      clockwise = turnPageGeometry(clockwise, 1);
      counter = turnPageGeometry(counter, -1);
    }
    expect(clockwise).toEqual(page);
    expect(counter).toEqual(page);
    expect(turnPageGeometry(turnPageGeometry(page, 1), -1)).toEqual(page);
  });
});

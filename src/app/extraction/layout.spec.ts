import { assignLines } from './layout';

describe('assignLines', () => {
  it('starts a new line when the vertical centre moves by more than half a line', () => {
    const lines = assignLines([
      { box: { x: 0, y: 0, w: 10, h: 10 } },
      { box: { x: 20, y: 4, w: 10, h: 10 } },
      { box: { x: 0, y: 12, w: 10, h: 10 } },
    ]).map((i) => i.line);
    expect(lines).toEqual([0, 0, 1]);
  });
});

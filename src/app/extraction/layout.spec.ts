import { assignLines, runsToWords, textToWords } from './layout';

describe('runsToWords', () => {
  it('splits runs into words with proportional boxes', () => {
    const words = runsToWords([{ text: 'Płytki krwi', box: { x: 100, y: 50, w: 110, h: 12 } }]);
    expect(words.map((w) => w.text)).toEqual(['Płytki', 'krwi']);
    expect(words[0].box).toEqual({ x: 100, y: 50, w: 60, h: 12 });
    expect(words[1].box).toEqual({ x: 170, y: 50, w: 40, h: 12 });
  });

  it('groups runs at the same height into one line, left to right', () => {
    const words = runsToWords([
      { text: '245', box: { x: 300, y: 101, w: 30, h: 12 } },
      { text: 'PLT', box: { x: 100, y: 100, w: 30, h: 12 } },
      { text: 'WBC', box: { x: 100, y: 130, w: 30, h: 12 } },
    ]);
    expect(words.map((w) => [w.text, w.line])).toEqual([
      ['PLT', 0],
      ['245', 0],
      ['WBC', 1],
    ]);
  });
});

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

describe('textToWords', () => {
  it('keeps one line per text line', () => {
    const words = textToWords('Pacjent: Anna\r\nPLT 245');
    expect(words.map((w) => [w.text, w.line])).toEqual([
      ['Pacjent:', 0],
      ['Anna', 0],
      ['PLT', 1],
      ['245', 1],
    ]);
  });
});

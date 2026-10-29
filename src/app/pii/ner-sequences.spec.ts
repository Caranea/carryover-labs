import { aggregateWord } from './labels';
import { buildSequences } from './ner-sequences';

// Fake tokenizer: one token per 3 characters.
const encode = (w: string) => Array.from({ length: Math.ceil(w.length / 3) }, (_, i) => w.length * 10 + i);

describe('buildSequences', () => {
  it('maps every word to its token span after the prefix', () => {
    const [seq] = buildSequences([['Anna', 'Nowak'], ['PLT']], encode, [0], [2]);
    expect(seq.ids[0]).toBe(0);
    expect(seq.ids[seq.ids.length - 1]).toBe(2);
    expect(seq.spans).toEqual([
      { word: 0, start: 1, end: 3 },
      { word: 1, start: 3, end: 5 },
      { word: 2, start: 5, end: 6 },
    ]);
  });

  it('starts a new sequence at a line boundary when the budget is reached', () => {
    const lines = [['aaaaaa', 'bbbbbb'], ['cccccc', 'dddddd']]; // 4 tokens per line
    const seqs = buildSequences(lines, encode, [0], [2], 7);
    expect(seqs.length).toBe(2);
    expect(seqs[1].spans.map((s) => s.word)).toEqual([2, 3]);
  });
});

describe('aggregateWord', () => {
  it('takes the most likely non-O label across sub-tokens', () => {
    const labels = { 0: 'O', 1: 'B-PERSON', 2: 'I-PERSON' };
    expect(aggregateWord([[0.9, 0.05, 0.05], [0.4, 0.1, 0.5]], labels)).toEqual({ label: 'I-PERSON', score: 0.5 });
  });
});

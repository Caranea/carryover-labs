import { WorkingWord } from '../app/core/models';

/** Words from plain text for tests: no boxes, one line per text line. */
export function textToWords(text: string, startId = 0): WorkingWord[] {
  const words: WorkingWord[] = [];
  let id = startId;
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .forEach((lineText, line) => {
      for (const token of lineText.split(/\s+/)) {
        if (token) words.push({ id: id++, text: token, line, hidden: false });
      }
    });
  return words;
}

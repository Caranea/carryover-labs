import { WorkingPage, WorkingWord } from '../core/models';
import { applyDetections, NORMAL, STRICT } from './detect';
import { decideLabel } from './labels';
import { detectWithRules, fileNameHints, isResultLine, sanitizeFileName } from './rules';
import { isValidPesel, parseDate } from './text-utils';

/** Build words from text lines; each character is 10px wide, lines 30px apart. */
function wordsFrom(lines: string[]): WorkingWord[] {
  const words: WorkingWord[] = [];
  let id = 0;
  lines.forEach((text, line) => {
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      words.push({
        id: id++,
        text: m[0],
        line,
        hidden: false,
        box: { x: m.index * 10, y: line * 30, w: m[0].length * 10, h: 20 },
      });
    }
  });
  return words;
}

function hiddenTexts(lines: string[], strict = false): string[] {
  const words = wordsFrom(lines);
  const hits = detectWithRules(words, { strict });
  return words.filter((w) => hits.has(w.id)).map((w) => w.text as string);
}

describe('text utils', () => {
  it('validates PESEL checksums', () => {
    expect(isValidPesel('44051401359')).toBe(true);
    expect(isValidPesel('44051401358')).toBe(false);
    expect(isValidPesel('4405140135')).toBe(false);
  });

  it('parses day-first and ISO dates', () => {
    expect(parseDate('14.05.1944')).toBe('1944-05-14');
    expect(parseDate('1944-05-14')).toBe('1944-05-14');
    expect(parseDate('14/05/1944')).toBe('1944-05-14');
    expect(parseDate('245')).toBeNull();
  });
});

describe('detectWithRules', () => {
  it('hides the value after Polish field labels but keeps the label', () => {
    const hidden = hiddenTexts(['Pacjent: Anna Nowak', 'PESEL: 44051401359']);
    expect(hidden).toEqual(['Anna', 'Nowak', '44051401359']);
  });

  it('stops a labelled value at the next field on the same line', () => {
    const hidden = hiddenTexts(['Pacjent: Anna Nowak Data pobrania: 12.03.2021']);
    expect(hidden).toEqual(['Anna', 'Nowak']);
  });

  it('hides every part of an upper-case name followed by another field', () => {
    const hidden = hiddenTexts(['Pacjent: NOWAK ANNA PESEL: 44051401359']);
    expect(hidden).toEqual(['NOWAK', 'ANNA', '44051401359']);
  });

  it('stops at a column gap', () => {
    const hidden = hiddenTexts(['Lekarz: Jan Kowalski          Oddział Hematologii']);
    expect(hidden).toEqual(['Jan', 'Kowalski']);
  });

  it('hides a name printed on the line below its label', () => {
    expect(
      hiddenTexts(['Nazwisko i imię:', '                      NOWAK                     ANNA']),
    ).toEqual(['NOWAK', 'ANNA']);
  });

  it('splits names below two labels by column', () => {
    const hidden = hiddenTexts([
      'Badanie wykonał:                              Autoryzował:',
      'ANNA NOWAK                                    JAN KOWALSKI',
    ]);
    expect(hidden).toEqual(['ANNA', 'NOWAK', 'JAN', 'KOWALSKI']);
  });

  it('hides names under an "Autoryzował" column header, not the lab name beside them', () => {
    const hidden = hiddenTexts([
      'Badanie  Daty            Materiał  Autoryzował     Laboratorium',
      '1        2024-09-09      SUROWICA  P.NOWAK, 19412  DIAGNOSTYKA S.A.',
      '2        2024-09-09      SUROWICA  A.KOWALSKA,     DIAGNOSTYKA S.A.',
    ]);
    expect(hidden).toEqual(['P.NOWAK,', '19412', 'A.KOWALSKA,']);
  });

  it('hides an initial, surname and licence number printed as one word', () => {
    expect(hiddenTexts(['Autoryzował : 1 - Z.NOWAK,12171;'])).toEqual(['Z.NOWAK,12171;']);
  });

  it('does not take a table header below a label as a name', () => {
    expect(hiddenTexts(['Lekarz:', 'Badanie Wynik Jedn. Zakres'])).toEqual([]);
  });

  it('hides Australian report fields: birthdate, telephone, surname-first doctors', () => {
    const hidden = hiddenTexts([
      'Birthdate: 01/01/1990 Age:',
      'Phone (02) 9123 4567',
      'Copy To : SMITH,DR.',
      'Addressee : BROWN, DR. A',
    ]);
    expect(hidden).toEqual(
      expect.arrayContaining(['01/01/1990', '(02)', '9123', '4567', 'SMITH,DR.', 'BROWN,']),
    );
  });

  it('takes a same-line name after a wide gap, and leaves the next line alone', () => {
    expect(
      hiddenTexts([
        'Patientenname           Doe, Jane         Geschlecht w',
        'Letzter Einsender demo',
      ]),
    ).toEqual(['Doe,', 'Jane']);
    expect(hiddenTexts(['URN: ne Patient Name Ane-Nuckear DOE, Ab JANE'])).toEqual(
      expect.arrayContaining(['DOE,', 'JANE']),
    );
  });

  it('hides the name after the German "Patientenname" label', () => {
    expect(hiddenTexts(['Patientenname Doe, Jane'])).toEqual(['Doe,', 'Jane']);
  });

  it('hides German and English labelled fields', () => {
    expect(hiddenTexts(['Geburtsdatum: 14.05.1944'])).toEqual(['14.05.1944']);
    expect(hiddenTexts(['Einsender: Dr. med. Klaus Weber'])).toEqual(
      expect.arrayContaining(['Klaus', 'Weber']),
    );
    expect(hiddenTexts(['Medicare No: 2953 51234 1'])).toEqual(['2953', '51234', '1']);
  });

  it('hides names after professional titles', () => {
    expect(hiddenTexts(['Autoryzacja dr n. med. Ewa Zielińska'])).toEqual(['Ewa', 'Zielińska']);
  });

  it('hides addresses, postal codes and towns outside result rows', () => {
    const hidden = hiddenTexts(['Laboratorium ul. Długa 12/3', '31-123 Kraków']);
    expect(hidden).toEqual(['Długa', '12/3', '31-123', 'Kraków']);
  });

  it('hides phone numbers split across words and e-mails', () => {
    const hidden = hiddenTexts(['Kontakt +48 601 234 567 biuro@lab.pl']);
    expect(hidden).toEqual(['+48', '601', '234', '567', 'biuro@lab.pl']);
  });

  it('hides long identifiers but never lab values in result rows', () => {
    const hidden = hiddenTexts([
      'Nr zlecenia 202103120045',
      'Płytki krwi 245 tys/µl 150-400',
      'Hemoglobina 13,2 g/dl 12,0 - 16,0',
    ]);
    expect(hidden).toEqual(['202103120045']);
  });

  it('recognises result rows', () => {
    expect(isResultLine(wordsFrom(['PLT 245 tys/µl 150-400']))).toBe(true);
    expect(isResultLine(wordsFrom(['Glukoza 92 70 - 99']))).toBe(true);
    expect(isResultLine(wordsFrom(['ul. Długa 12 31-123 Kraków']))).toBe(false);
  });

  it('expands around names in strict mode only', () => {
    // OCR put a wide gap inside the name, so the label value stops after "Jan".
    const lines = ['Lekarz: Jan          Kowalski'];
    expect(hiddenTexts(lines, false)).toEqual(['Jan']);
    expect(hiddenTexts(lines, true)).toEqual(['Jan', 'Kowalski']);
  });
});

describe('decideLabel', () => {
  it('hides identity labels and keeps health, plain dates and organisations', () => {
    expect(decideLabel('B-PERSON')).toEqual({ hide: true, kind: 'person' });
    expect(decideLabel('I-STREET_ADDRESS')).toEqual({ hide: true, kind: 'address' });
    expect(decideLabel('B-DATE_OF_BIRTH')).toEqual({ hide: true, kind: 'birth-date' });
    expect(decideLabel('B-MEDICAL_RECORD_NUMBER').hide).toBe(true);
    expect(decideLabel('B-HEALTH_DATA').hide).toBe(false);
    expect(decideLabel('B-DATE').hide).toBe(false);
    expect(decideLabel('B-ORGANIZATION').hide).toBe(false);
    expect(decideLabel('O').hide).toBe(false);
    expect(decideLabel('B-SOMETHING_NEW')).toMatchObject({ hide: false, review: true });
    for (const label of [
      'PROPER_NAME',
      'PERSON_ATTRIBUTE',
      'PERSON_ROLE_OR_TITLE',
      'DOCUMENT_REFERENCE',
    ]) {
      expect(decideLabel(label)).toMatchObject({ hide: false, review: true });
    }
    expect(decideLabel('PHONE_NUMBER')).toEqual({ hide: true, kind: 'contact' });
  });
});

describe('applyDetections', () => {
  const page = (lines: string[]): WorkingPage => ({
    index: 0,
    width: 1000,
    height: 1000,
    image: null,
    imageUrl: null,
    words: wordsFrom(lines),
    regions: [],
    ocr: false,
  });

  it('treats a file name as a suggestion, never proof of identity', () => {
    const hints = fileNameHints('Jane_Doe_morfologia_2012.png');
    expect([...hints]).toEqual(['jane', 'doe']);
    const [p] = applyDetections(
      [page(['JANE DOE', 'Hemoglobin 13 g/dl 12-16'])],
      [null],
      NORMAL,
      hints,
    );
    expect(p.words.filter((w) => w.hidden)).toEqual([]);
    expect(p.words.filter((w) => w.candidate).map((w) => w.text)).toEqual(['JANE', 'DOE']);
    const [q] = applyDetections(
      [page(['TSH 1,5 mIU/l 0,3-4', 'TSH'])],
      [null],
      NORMAL,
      fileNameHints('TSH_wyniki.pdf'),
    );
    expect(q.words.filter((w) => w.hidden)).toEqual([]);
  });

  it('does not take the label of the next field as a value', () => {
    const hidden = hiddenTexts(['Pacjent: Data rej.: 2014-02-09', 'NOWAK ANNA']);
    expect(hidden).toEqual(['NOWAK', 'ANNA']);
  });

  it('uses model predictions above the threshold and protects result values', () => {
    const p = page(['Zlecił Marek Wiśniewski', 'Płytki krwi 245 tys/µl 150-400']);
    const preds = new Map([
      [1, { label: 'B-PERSON', score: 0.9 }],
      [2, { label: 'I-PERSON', score: 0.4 }],
      [5, { label: 'B-ID_NUMBER', score: 0.95 }], // "245" in a result row
    ]);
    const normal = applyDetections([p], [preds], NORMAL)[0]
      .words.filter((w) => w.hidden)
      .map((w) => w.text);
    expect(normal).toEqual(['Marek']);
    const strict = applyDetections([p], [preds], STRICT)[0]
      .words.filter((w) => w.hidden)
      .map((w) => w.text);
    expect(strict).toEqual(['Marek']);
    expect(applyDetections([p], [preds], STRICT)[0].words[2]).toMatchObject({
      hidden: false,
      candidate: 'person',
    });
  });

  it('propagates a hidden name to every page and respects user choices', () => {
    const p1 = page(['Pacjent: Anna Nowak']);
    const p2 = { ...page(['Nowak Anna wyniki', 'Nowak']), index: 1 };
    p2.words[3] = { ...p2.words[3], userSet: true, hidden: false };
    const [, out2] = applyDetections([p1, p2], [null, null], NORMAL);
    expect(out2.words.map((w) => w.hidden)).toEqual([true, true, false, false]);
  });

  it('never reveals words already removed on the server', () => {
    const p = page(['zwykły tekst']);
    p.words[0] = { ...p.words[0], text: null, hidden: true, locked: true };
    const out = applyDetections([p], [null], NORMAL)[0];
    expect(out.words[0]).toMatchObject({ hidden: true, locked: true, text: null });
  });
});

describe('sanitizeFileName', () => {
  it('removes words hidden in the document and long numbers from file names', () => {
    expect(
      sanitizeFileName('Kowalska_Jane_morfologia_2021-03-12.pdf', ['Jane', 'Kowalskiej']),
    ).toBe('▇▇▇_▇▇▇_morfologia_2021-03-12');
    expect(sanitizeFileName('wynik 44051401359.jpg')).toBe('wynik ▇▇▇');
    expect(sanitizeFileName('morfologia.pdf', ['Nowak'])).toBe('morfologia');
  });
});

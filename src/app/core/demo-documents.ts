import type { Language } from '@shared/results';

/**
 * The /demo patient's original documents: ten of the cleaned `selection_20` fixtures, served from
 * public/samples/jane-doe. Polish lab PDFs from two labs and two layouts, a German cumulative report
 * and an English fax from 2012, both photographed. Every name, lab, address and identifier on them
 * is fictional.
 */
export interface DemoPage {
  /** Relative to the base href. */
  src: string;
  width: number;
  height: number;
}
/** One original document, as the patient handed it in. */
export interface DemoDocument {
  id: string;
  /** The file name. */
  name: string;
  /** What the document contains, in its own language. */
  title: string;
  /** Collection date (YYYY-MM-DD); for the cumulative table, its latest column. */
  date: string;
  language: Language;
  kind: 'pdf' | 'image';
  /** Why the document is interesting for the demo, if it is. */
  note: string | null;
  thumb: string;
  pages: DemoPage[];
}

/** The input documents, oldest first. */
export const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    id: 'jane-doe-039',
    name: 'Jane_Doe_039.png',
    title: 'Cumulative haematology, four dates',
    date: '2012-07-25',
    language: 'en',
    kind: 'image',
    note: 'Phone photo of a fax',
    thumb: 'samples/jane-doe/jane-doe-039-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-039-p1.webp',
        width: 1200,
        height: 1594,
      },
    ],
  },
  {
    id: 'jane-doe-lab-03',
    name: 'Jane_Doe_lab_03.pdf',
    title: 'Morfologia, CRP, glukoza, kreatynina, elektrolity',
    date: '2014-02-09',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-03-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-03-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-03-p2.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-03-p3.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-lab-10',
    name: 'Jane_Doe_lab_10.pdf',
    title: 'TSH, FT3, FT4',
    date: '2021-01-21',
    language: 'pl',
    kind: 'pdf',
    note: 'Different reference ranges',
    thumb: 'samples/jane-doe/jane-doe-lab-10-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-10-p1.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-lab-12',
    name: 'Jane_Doe_lab_12.pdf',
    title: 'Morfologia, CRP, TSH, FT3, FT4',
    date: '2021-04-22',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-12-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-12-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-12-p2.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-12-p3.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-lab-13',
    name: 'Jane_Doe_lab_13.pdf',
    title: 'Morfologia, lipidogram, TSH, FT3, FT4, anty-TPO',
    date: '2021-11-27',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-13-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-13-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-13-p2.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-13-p3.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-002',
    name: 'Jane_Doe_002.png',
    title: 'Kumulativbericht: Klinische Chemie, Blutbild',
    date: '2022-03-03',
    language: 'de',
    kind: 'image',
    note: 'Phone photo, German',
    thumb: 'samples/jane-doe/jane-doe-002-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-002-p1.webp',
        width: 1200,
        height: 1594,
      },
    ],
  },
  {
    id: 'jane-doe-lab-19',
    name: 'Jane_Doe_lab_19.pdf',
    title: 'Morfologia + rozmaz',
    date: '2022-08-03',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-19-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-19-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-19-p2.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-lab-23',
    name: 'Jane_Doe_lab_23.pdf',
    title: 'Morfologia, TSH, FT3, FT4',
    date: '2023-02-20',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-23-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-23-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-23-p2.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-23-p3.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-lab-27',
    name: 'Jane_Doe_lab_27.pdf',
    title: 'Morfologia, rozmaz, TSH, FT3, FT4',
    date: '2023-11-13',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-27-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-27-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-27-p2.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-27-p3.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
  {
    id: 'jane-doe-lab-28',
    name: 'Jane_Doe_lab_28.pdf',
    title: 'Morfologia, TSH, FT3, FT4, TRAb, anty-TPO, anty-TG',
    date: '2024-09-09',
    language: 'pl',
    kind: 'pdf',
    note: null,
    thumb: 'samples/jane-doe/jane-doe-lab-28-thumb.webp',
    pages: [
      {
        src: 'samples/jane-doe/jane-doe-lab-28-p1.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-28-p2.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-28-p3.webp',
        width: 1100,
        height: 1559,
      },
      {
        src: 'samples/jane-doe/jane-doe-lab-28-p4.webp',
        width: 1100,
        height: 1559,
      },
    ],
  },
];

export function demoPage(documentId: string, page: number): DemoPage | undefined {
  return DEMO_DOCUMENTS.find((d) => d.id === documentId)?.pages[page];
}

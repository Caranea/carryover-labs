/**
 * The content of the landing page's walkthrough: six of Jane Doe's sample documents and four of
 * her tests. Row outlines, printed values and flags are copied from core/demo-data.ts, so it shows
 * what the /demo page shows. Jane is fictional.
 */

/** [x, y, w, h]. */
type Box = readonly [number, number, number, number];

export interface FilmDocument {
  src: string;
  /** The page image's size, in pixels. */
  width: number;
  height: number;
  /** "Report of …", never the file name: that would show the patient's name beside the bars. */
  label: string;
  language: string;
  year: string;
  /** The column heading, on two lines. */
  day: string;
  /** Phone photos carry a colour cast that would fight the theme. */
  photo: boolean;
  /** The share of a row's outline to mark: name and value, not the range after them. */
  rowReach: number;
  /** One outline per test, in page-image pixels, in ROWS order. */
  rows: readonly Box[];
  /** Details to black out, as shares of the page. */
  redactions: readonly Box[];
}

const page = (id: string) => `samples/jane-doe/${id}-p1.webp`;

/** Newest first, as the results page lists them. */
export const DOCUMENTS: readonly FilmDocument[] = [
  {
    src: page('jane-doe-lab-28'),
    width: 1100,
    height: 1559,
    label: 'Report of 9 Sep 2024',
    language: 'Polish',
    year: '2024',
    day: '9 Sep',
    photo: false,
    rowReach: 0.5,
    rows: [
      [69, 631, 835, 34],
      [69, 664, 847, 29],
      [69, 724, 847, 35],
      [69, 879, 842, 35],
    ],
    redactions: [
      [0.148, 0.262, 0.125, 0.02],
      [0.148, 0.282, 0.385, 0.017],
      [0.793, 0.264, 0.105, 0.016],
      [0.793, 0.282, 0.105, 0.016],
      [0.612, 0.855, 0.185, 0.02],
    ],
  },
  {
    src: page('jane-doe-lab-23'),
    width: 1100,
    height: 1559,
    label: 'Report of 20 Feb 2023',
    language: 'Polish',
    year: '2023',
    day: '20 Feb',
    photo: false,
    rowReach: 0.5,
    rows: [
      [69, 663, 835, 34],
      [69, 695, 847, 29],
      [69, 755, 829, 35],
      [69, 849, 842, 35],
    ],
    redactions: [
      [0.163, 0.262, 0.125, 0.02],
      [0.163, 0.282, 0.385, 0.017],
      [0.755, 0.264, 0.105, 0.016],
      [0.755, 0.282, 0.105, 0.016],
      [0.628, 0.847, 0.185, 0.02],
    ],
  },
  {
    src: page('jane-doe-002'),
    width: 1200,
    height: 1594,
    label: 'Report of 3 Mar 2022',
    language: 'German, phone photo',
    year: '2022',
    day: '3 Mar',
    photo: true,
    rowReach: 1,
    rows: [
      [96, 1155, 340, 36],
      [96, 1118, 340, 36],
      [96, 1229, 340, 36],
      [96, 1376, 340, 36],
    ],
    redactions: [
      [0.205, 0.094, 0.1, 0.018],
      [0.61, 0.106, 0.085, 0.016],
    ],
  },
  {
    src: page('jane-doe-lab-12'),
    width: 1100,
    height: 1559,
    label: 'Report of 22 Apr 2021',
    language: 'Polish',
    year: '2021',
    day: '22 Apr',
    photo: false,
    rowReach: 0.5,
    rows: [
      [69, 663, 847, 34],
      [69, 695, 847, 29],
      [69, 755, 831, 35],
      [69, 849, 842, 35],
    ],
    redactions: [
      [0.163, 0.262, 0.125, 0.02],
      [0.163, 0.282, 0.4, 0.017],
      [0.755, 0.264, 0.105, 0.016],
      [0.755, 0.282, 0.105, 0.016],
      [0.668, 0.85, 0.185, 0.02],
    ],
  },
  {
    src: page('jane-doe-lab-03'),
    width: 1100,
    height: 1559,
    label: 'Report of 9 Feb 2014',
    language: 'Polish',
    year: '2014',
    day: '9 Feb',
    photo: false,
    rowReach: 0.5,
    rows: [
      [53, 646, 841, 39],
      [53, 683, 854, 35],
      [53, 749, 837, 40],
      [53, 854, 921, 35],
    ],
    redactions: [
      [0.045, 0.216, 0.158, 0.026],
      [0.715, 0.244, 0.105, 0.017],
      [0.715, 0.842, 0.18, 0.02],
      [0.3, 0.835, 0.17, 0.014],
    ],
  },
  {
    src: page('jane-doe-039'),
    width: 1200,
    height: 1594,
    label: 'Report of 25 Jul 2012',
    language: 'English, photo of a fax',
    year: '2012',
    day: '25 Jul',
    photo: true,
    rowReach: 1,
    rows: [
      [151, 736, 461, 22],
      [154, 692, 461, 22],
      [151, 781, 456, 22],
      [143, 938, 465, 22],
    ],
    redactions: [
      [0.135, 0.298, 0.085, 0.016],
      [0.265, 0.302, 0.105, 0.014],
      [0.138, 0.313, 0.19, 0.015],
      [0.575, 0.31, 0.085, 0.014],
      [0.14, 0.325, 0.125, 0.015],
    ],
  },
];

export interface FilmRow {
  name: string;
  unit: string;
  /** The test's name as printed on each document, in DOCUMENTS order. */
  printedAs: readonly string[];
  /** Values as the results page shows them, in the test's common unit. */
  values: readonly string[];
  /** Indexes of the values the lab flagged low. */
  low: readonly number[];
}

export const ROWS: readonly FilmRow[] = [
  {
    name: 'Red blood cells',
    unit: '10¹²/L',
    printedAs: [
      'Erytrocyty',
      'Erytrocyty',
      'Erythrozyten i. VB.',
      'Erytrocyty',
      'Erytrocyty',
      'RCC',
    ],
    values: ['4.5', '4.9', '4.35', '4.84', '4.6', '4.2'],
    low: [],
  },
  {
    name: 'Haemoglobin',
    unit: 'g/dL',
    printedAs: [
      'Hemoglobina',
      'Hemoglobina',
      'Hb i. VB.',
      'Hemoglobina',
      'Hemoglobina',
      'Haemoglobin',
    ],
    values: ['13.7', '14.9', '13.0', '14.8', '12.9', '12.2'],
    low: [],
  },
  {
    name: 'MCV',
    unit: 'fL',
    printedAs: ['MCV', 'MCV', 'MCV i. VB.', 'MCV', 'MCV', 'MCV'],
    values: ['87.9', '86', '86.2', '88', '83', '85'],
    low: [],
  },
  {
    name: 'Platelets',
    unit: '10⁹/L',
    printedAs: [
      'Płytki krwi',
      'Płytki krwi',
      'Thrombozyten i. VB.',
      'Płytki krwi',
      'Płytki krwi',
      'Platelets',
    ],
    values: ['175', '159', '130', '230', '98', '262'],
    low: [2, 4],
  },
];

/** The value the walkthrough ends on, traced back to its page. */
export const TRACED = { document: 4, row: 3 } as const;

export const STEPS = [
  {
    title: 'Add your results',
    text: 'Choose a photo, PDF, Word file, or text document from any lab.',
  },
  {
    title: 'Check personal details',
    text: 'Your device suggests details to hide. Review every page and add any missing black bars.',
  },
  {
    title: 'View your history',
    text: 'Save the approved copy in this browser, explore results over time, and print them for your appointment.',
  },
] as const;

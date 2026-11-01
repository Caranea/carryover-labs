import type { RecordsResponse, RecordPoint, RecordDomain, RecordWarning } from '@shared/records';
import type { Observation, ResultsResponse, Language } from '@shared/results';

/** Entirely invented data. Never derived from the private photo fixtures or patient records. */
const visits: { date: string; language: Language; labels: string[]; values: number[] }[] = [
  {
    date: '2020-02-12',
    language: 'pl',
    labels: ['TSH', 'Tyroksyna wolna', 'Płytki krwi', 'Glukoza'],
    values: [3.1, 14.2, 251, 91],
  },
  {
    date: '2021-06-18',
    language: 'de',
    labels: ['Thyreotropin', 'Freies T4', 'Thrombozyten', 'Glukose'],
    values: [2.6, 15.1, 238, 94],
  },
  {
    date: '2022-11-09',
    language: 'en',
    labels: ['TSH', 'Free T4', 'Platelets', 'Glucose'],
    values: [2.9, 14.8, 264, 89],
  },
  {
    date: '2024-03-21',
    language: 'pl',
    labels: ['TSH', 'FT4', 'Płytki krwi', 'Glukoza'],
    values: [2.2, 15.5, 247, 96],
  },
  {
    date: '2026-09-15',
    language: 'en',
    labels: ['Thyroid stimulating hormone', 'Free T4', 'PLT', 'Glucose'],
    values: [2.4, 15.2, 256, 93],
  },
];
const tests = [
  { key: 'tsh', label: 'TSH', unit: 'mIU/L', range: '0.4–4.0', low: 0.4, high: 4 },
  { key: 'ft4', label: 'Free T4', unit: 'pmol/L', range: '12–22', low: 12, high: 22 },
  { key: 'plt', label: 'Platelets', unit: '10^9/L', range: '150–400', low: 150, high: 400 },
  { key: 'glucose', label: 'Glucose', unit: 'mg/dL', range: '70–99', low: 70, high: 99 },
];
const documentId = (index: number) => `sample-${index + 1}`;
const documentName = (index: number) => `Sample report ${index + 1}`;
const valueText = (value: number, language: Language) =>
  language === 'en' ? String(value) : String(value).replace('.', ',');

const observations: Observation[] = visits.flatMap((visit, visitIndex) =>
  tests.map((test, testIndex) => ({
    id: `${documentId(visitIndex)}-${test.key}`,
    documentId: documentId(visitIndex),
    page: 0,
    bbox: null,
    words: [],
    name: visit.labels[testIndex],
    value: visit.values[testIndex],
    valueText: valueText(visit.values[testIndex], visit.language),
    comparator: null,
    unit: test.unit,
    refLow: test.low,
    refHigh: test.high,
    refText: test.range,
    flag: null,
    date: visit.date,
    dateSource: 'label',
    revision: 'sample-read-only',
  })),
);

// A deliberately incomplete source row demonstrates that uncertainty is shown, never filled in.
observations.push({
  id: 'sample-5-ferritin',
  documentId: 'sample-5',
  page: 0,
  bbox: null,
  words: [],
  name: 'Ferritin',
  value: 42,
  valueText: '42',
  comparator: null,
  unit: null,
  refLow: null,
  refHigh: null,
  refText: null,
  flag: null,
  date: visits[4].date,
  dateSource: 'label',
  revision: 'sample-read-only',
});

export const DEMO_SOURCE_PAGES: Record<string, string[]> = Object.fromEntries(
  visits.map((visit, index) => [
    documentId(index),
    [
      [
        'FICTIONAL SAMPLE — no real patient',
        documentName(index),
        `${visit.language === 'pl' ? 'Data pobrania' : visit.language === 'de' ? 'Entnahmedatum' : 'Collection date'}: ${visit.date}`,
        '',
        'Test | Result | Unit | Printed reference range',
        ...tests.map(
          (test, ti) =>
            `${visit.labels[ti]} | ${valueText(visit.values[ti], visit.language)} | ${test.unit} | ${test.range}`,
        ),
        ...(index === 4 ? ['Ferritin | 42 | [unit not printed] | [range not printed]'] : []),
        '',
        'These invented values illustrate record organisation only. Reference ranges are copied as part of this fictional report.',
      ].join('\n'),
    ],
  ]),
);

export const DEMO_RESULTS: ResultsResponse = {
  documents: visits.map((visit, index) => ({
    id: documentId(index),
    name: documentName(index),
    sourceKind: 'text',
    pageCount: 1,
    locale: {
      language: visit.language,
      decimal: visit.language === 'en' ? '.' : ',',
      dateOrder: 'YMD',
      collectionDate: visit.date,
      collectionDateSource: 'label',
    },
    count: index === 4 ? 5 : 4,
  })),
  observations,
};

function chart(testIndex: number) {
  const test = tests[testIndex];
  const points: RecordPoint[] = visits.map((visit, index) => ({
    observationId: `${documentId(index)}-${test.key}`,
    documentId: documentId(index),
    documentName: documentName(index),
    page: 0,
    bbox: null,
    date: visit.date,
    value: visit.values[testIndex],
    comparator: null,
    printedName: visit.labels[testIndex],
    printedValue: valueText(visit.values[testIndex], visit.language),
    printedUnit: test.unit,
    printedReference: test.range,
    flag: null,
    dateKind: null,
    conversion: null,
    alsoIn: [],
  }));
  return {
    id: `sample-${test.key}`,
    unit: test.unit,
    series: [
      {
        key: test.key,
        label: test.label,
        unit: test.unit,
        printedNames: [...new Set(visits.map((v) => v.labels[testIndex]))],
        points,
      },
    ],
  };
}
const domains: RecordDomain[] = [
  { key: 'blood-count', label: 'Complete blood count', charts: [chart(2)] },
  { key: 'metabolic', label: 'Glucose and diabetes', charts: [chart(3)] },
  { key: 'thyroid', label: 'Thyroid', charts: [chart(0), chart(1)] },
];
const warnings: RecordWarning[] = [
  {
    observationId: 'sample-5-ferritin',
    documentId: 'sample-5',
    documentName: documentName(4),
    page: 0,
    bbox: null,
    reason: 'unit',
    detail:
      'The report does not print a unit. Check the source before adding this result to a chart.',
    by: 'rules',
    printedName: 'Ferritin',
    printedValue: '42',
    printedUnit: null,
    date: visits[4].date,
  },
];

export const DEMO_RECORDS: RecordsResponse = {
  domains,
  warnings,
  textResults: [],
  stats: {
    documents: visits.length,
    tests: tests.length,
    values: 20,
    from: visits[0].date,
    to: visits[4].date,
  },
  model: {
    state: 'off',
    name: null,
    waiting: 0,
    message: 'This fictional sample is prepared in advance and does not call an AI model.',
  },
};

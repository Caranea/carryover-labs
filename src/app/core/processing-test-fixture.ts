import { PROCESSING_VERSION, type PageRequest, type PageTranscription, type PrintedRow } from '../../../api/src/demo/processing-contract';
import type { RecordsResponse } from './records';

export function printedFixture(): PrintedRow {
  return { name: 'TSH', value: '2.4', unit: 'mIU/L', reference: '0.4-4.0', flag: null,
    collectionDate: { printed: '2026-09-15', iso: '2026-09-15' }, orderDate: { printed: null, iso: null }, reportDate: { printed: null, iso: null },
    specimen: null, method: null, region: null, uncertainty: [] };
}
export function processedFixture(source: Omit<PageRequest, 'image' | 'batchId'> & { batchId?: string }): PageTranscription {
  const row = printedFixture();
  return { ...source, batchId: source.batchId ?? 'batch-test', version: PROCESSING_VERSION, rows: [row],
    observations: [{ id: `${source.pageId}:0`, documentId: source.documentId, page: source.page, bbox: null, words: [],
      sourceImage: { pageId: source.pageId, revision: source.revision, row: 0 }, transcription: row,
      name: 'TSH', valueText: '2.4', value: 2.4, unit: 'mIU/L', comparator: null, refLow: null, refHigh: null, refText: '0.4-4.0', flag: null,
      date: '2026-09-15', dateSource: 'label', revision: 'test-revision' }], issues: [], suggestedName: 'Thyroid tests' };
}
export function recordsFixture(documents = 1): RecordsResponse {
  return { domains: [], textResults: [], warnings: [], issues: [], stats: { documents, tests: documents ? 1 : 0, values: documents, from: null, to: null },
    model: { state: 'ready', name: 'Synthetic Meta', waiting: 0, message: null } };
}

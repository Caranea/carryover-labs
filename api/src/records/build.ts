import { createHash } from 'node:crypto';
import { buildRecords as buildCore, type BuildDocument } from './build-core.js';
import type { Knowledge } from './knowledge-types.js';
export { groupIntoCharts } from './build-core.js';
export type { BuildDocument, Pending, Review, ReviewRow } from './build-core.js';

/** Server chart building uses a stable hash to bind reviews to their source rows. */
export function buildRecords(docs: BuildDocument[], knowledge: Knowledge, modelOn: boolean) {
  return buildCore(docs, knowledge, modelOn, (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16));
}

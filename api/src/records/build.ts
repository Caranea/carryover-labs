import { createHash } from 'node:crypto';
import { buildRecords as buildCore, type BuildDocument } from './build-core.js';
import type { Knowledge } from './knowledge-types.js';
export { groupIntoCharts } from './build-core.js';
export type { BuildDocument, Pending, Review, ReviewRow } from './build-core.js';

/** Keep the server's existing review fingerprint while sharing pure chart logic with the browser. */
export function buildRecords(docs: BuildDocument[], knowledge: Knowledge, modelOn: boolean) {
  return buildCore(docs, knowledge, modelOn, (rows) => createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16));
}

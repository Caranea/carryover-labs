import { DEMO_RECORDS } from '../core/demo-data';
import { selectDomains, sourceReferences } from './appointment.page';

describe('appointment selection', () => {
  it('only includes selected domains without changing the original record', () => {
    const key = DEMO_RECORDS.domains[0].key;
    expect(selectDomains(DEMO_RECORDS.domains, new Set([key])).map((d) => d.key)).toEqual([key]);
    expect(DEMO_RECORDS.domains.length).toBeGreaterThan(1);
  });
  it('retains source references for unresolved and written results even when no chart group is selected', () => {
    const refs = sourceReferences(DEMO_RECORDS, []);
    for (const result of [...DEMO_RECORDS.warnings, ...DEMO_RECORDS.textResults]) {
      expect(refs.some((r) => r.documentId === result.documentId && r.page === result.page)).toBe(
        true,
      );
    }
    expect(new Set(refs.map((r) => r.documentId + ':' + r.page)).size).toBe(refs.length);
  });
  it('includes duplicate copies of plotted readings in the browser and print bibliography', () => {
    const records = structuredClone(DEMO_RECORDS);
    const point = records.domains[0].charts[0].series[0].points[0];
    point.alsoIn.push({
      ...point,
      documentId: 'duplicate-copy',
      documentName: 'Duplicate source',
      page: 2,
    });
    const refs = sourceReferences(records, records.domains);
    expect(refs.some((ref) => ref.documentId === 'duplicate-copy' && ref.page === 2)).toBe(true);
  });
});

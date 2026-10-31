import { createAppointmentPdf } from './pdf-engine';
import { DEMO_RECORDS } from '../core/demo-data';
import {
  AppointmentPdfInput,
  appointmentPdfDefinition,
  PDF_LIMITS,
  pdfSources,
  pdfValue,
  seriesSvg,
  validatePdfInput,
} from './appointment-pdf';

const input = (): AppointmentPdfInput => ({
  records: structuredClone(DEMO_RECORDS),
  questions: 'Płytki krwi, żółć, Überprüfung, Grüße - questions for my doctor.',
  preparedAt: '2026-10-29T10:00:00.000Z',
  fictional: true,
});

describe('appointment PDF', () => {
  it('contains selected groups, Unicode questions, unresolved readings and bibliography', () => {
    const data = input();
    data.records.domains = [data.records.domains[0]];
    const definition = appointmentPdfDefinition(data);
    const content = JSON.stringify(definition.content);
    expect(content).toContain('Płytki krwi, żółć, Überprüfung, Grüße');
    expect(content).toContain('Readings to check');
    expect(content).toContain('Source bibliography');
    expect(content).toContain('2020-02-12');
    expect(content).not.toContain('Platelets (');
    expect(content).toContain('Matching status at export: automatic matching is not configured');
    expect(content).toContain('FICTIONAL SAMPLE');
    expect(
      pdfSources(data.records).some(
        (ref) => ref.documentId === data.records.warnings[0].documentId,
      ),
    ).toBe(true);
  });
  it('retains comparator and conversion labels without connecting bounded readings', () => {
    const data = input();
    const series = data.records.domains[0].charts[0].series[0];
    const point = {
      ...series.points[0],
      comparator: '<' as const,
      value: 4.5,
      conversion: { from: 'original', factor: 2 },
      printedValue: '<2.25',
    };
    expect(pdfValue(point)).toBe('<4.5');
    expect(seriesSvg({ ...series, points: [point] })).toContain('fill="#ffffff"');
    series.points[0] = point;
    expect(JSON.stringify(appointmentPdfDefinition(data).content)).toContain(
      'Unit converted for this chart.',
    );
  });
  it('rejects oversized selections and invalid values instead of silently dropping rows', () => {
    const data = input();
    const series = data.records.domains[0].charts[0].series[0];
    data.records.domains[0].charts[0].series = Array.from(
      { length: PDF_LIMITS.series + 1 },
      () => series,
    );
    expect(() => validatePdfInput(data)).toThrow('Choose fewer groups');
    const bad = input();
    bad.records.domains[0].charts[0].series[0].points[0].value = NaN;
    expect(() => validatePdfInput(bad)).toThrow('invalid value or date');
  });
  it('generates a real self-contained PDF deterministically with embedded fonts', async () => {
    const a = await createAppointmentPdf(input());
    const b = await createAppointmentPdf(input());
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe('%PDF-');
    expect(a.byteLength).toBeGreaterThan(10_000);
    expect(a.byteLength).toBeLessThan(PDF_LIMITS.bytes);
    expect(a).toEqual(b);
  }, 30_000);
});

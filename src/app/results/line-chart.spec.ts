import { formatUnit, niceScale, timeTicks } from './line-chart';

describe('line chart scales', () => {
  it('rounds the y axis and never goes below zero for lab values', () => {
    expect(niceScale(0, 0).lo).toBe(0);
    const s = niceScale(12.1, 15.7);
    expect(s.lo).toBeLessThanOrEqual(12.1);
    expect(s.hi).toBeGreaterThanOrEqual(15.7);
    expect(s.ticks.length).toBeGreaterThanOrEqual(3);
    expect(niceScale(0.03, 6).lo).toBe(0);
  });

  it('labels years for long spans and months for short ones', () => {
    const y = timeTicks(Date.UTC(2012, 5, 1), Date.UTC(2024, 8, 1), 500);
    expect(y.every((t) => /^\d{4}$/.test(t.label))).toBe(true);
    expect(y.length).toBeLessThanOrEqual(8);
    const m = timeTicks(Date.UTC(2023, 10, 1), Date.UTC(2024, 8, 1), 500);
    expect(m.every((t) => /[A-Za-z]/.test(t.label))).toBe(true);
  });

  it('writes powers of ten as superscripts', () => {
    expect(formatUnit('10^9/L')).toBe('10⁹/L');
    expect(formatUnit('10^12/L')).toBe('10¹²/L');
  });
});

import { nearestPointIndex, pointDisplay } from './line-chart';
import { DEMO_RECORDS } from '../core/demo-data';

describe('chart reading access', () => {
  it('keeps a comparator visible after unit conversion', () => {
    const point = DEMO_RECORDS.domains[0].charts[0].series[0].points[0];
    expect(pointDisplay({ ...point, value: 4.5, comparator: '<', conversion: { from: 'original', factor: 2 }, printedValue: '<2.25' })).toBe('<4.5');
  });
  it('selects a touched point without a preceding hover and ignores empty space', () => {
    const points = [{ x: 100, y: 50 }, { x: 100, y: 120 }, { x: 220, y: 85 }];
    expect(nearestPointIndex(points, 101, 118)).toBe(1);
    expect(nearestPointIndex(points, 160, 85)).toBe(-1);
  });
});

import { describe, expect, it } from 'vitest';
import { downloadEstimate, observedDownlinkMbps, pageEstimate } from './processing-estimate';
describe('processing estimates', () => {
  const device = { supported: true, memoryGb: 8, cores: 8 };
  it('uses only real transfers from the chosen host, excluding cache hits', () => {
    expect(
      observedDownlinkMbps('https://app.test', [
        {
          name: 'https://app.test/main.js',
          transferSize: 1_000_000,
          responseStart: 100,
          responseEnd: 200,
        },
        {
          name: 'https://app.test/cached.js',
          transferSize: 0,
          responseStart: 100,
          responseEnd: 101,
        },
        {
          name: 'https://another.test/model',
          transferSize: 10_000_000,
          responseStart: 100,
          responseEnd: 101,
        },
      ]),
    ).toBe(80);
  });
  it('separates the selected model download and removes it for a cached checker', () => {
    expect(downloadEstimate(279_000_000, 10, false)).toBe('First download: ~4 min (279 MB)');
    expect(downloadEstimate(556_000_000, 10, false)).toBe('First download: ~7 min (556 MB)');
    expect(downloadEstimate(556_000_000, 10, true)).toBe('Checker saved · no download');
  });
  it('states its network assumption instead of treating an unknown connection as measured', () => {
    expect(downloadEstimate(279_000_000, null, false)).toContain('at 10 Mbps');
  });
  it('replaces a rough range with measured detector plus OCR time per page', () => {
    expect(pageEstimate('gpu-fp16', device, [], [])).toContain('Roughly');
    expect(pageEstimate('gpu-fp16', device, [{ words: 1000, milliseconds: 20000 }], [5000])).toBe(
      '~15 sec/page',
    );
  });
});

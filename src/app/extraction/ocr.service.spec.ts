import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrService } from './ocr.service';
import { orientationTurns } from './orientation';

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: mocks.createWorker } }));

describe('orientation before text recognition', () => {
  const detect = vi.fn(), recognize = vi.fn();
  const good = { confidence: 95, blocks: [{ paragraphs: [{ lines: [{ bbox: { x0: 0, y0: 0, x1: 80, y1: 20 },
    words: [{ text: 'SyntheticReport'.repeat(10), confidence: 95, bbox: { x0: 0, y0: 0, x1: 80, y1: 20 } }] }] }] }] };
  beforeEach(() => {
    detect.mockReset(); recognize.mockReset().mockResolvedValue({ data: good });
    mocks.createWorker.mockReset().mockImplementation(async (language: string) => language === 'osd'
      ? { detect, terminate: vi.fn() } : { recognize, terminate: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn() } as never);
  });
  afterEach(() => vi.restoreAllMocks());
  it('rotates first, recognises once, and returns matching image dimensions and word boxes', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 270, orientation_confidence: 14 } });
    const canvas = document.createElement('canvas'); canvas.width = 2200; canvas.height = 1600;
    const result = await new OcrService().recognizeUpright(canvas, 100);
    expect(detect.mock.invocationCallOrder[0]).toBeLessThan(recognize.mock.invocationCallOrder[0]);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(result.canvas.width).toBe(1600); expect(result.canvas.height).toBe(2200);
    expect(recognize.mock.calls[0][0]).toBe(result.canvas);
    expect(result.words[0].id).toBe(100); expect(result.words[0].box).toEqual({ x: 0, y: 0, w: 80, h: 20 });
  });
  it('continues normal OCR if orientation detection is unavailable', async () => {
    detect.mockRejectedValue(new Error('No orientation data'));
    const canvas = document.createElement('canvas');
    expect((await new OcrService().recognizeUpright(canvas, 0)).canvas).toBe(canvas);
    expect(recognize).toHaveBeenCalledTimes(1);
  });
  it('does not rotate uncertain or invalid results', () => {
    expect(orientationTurns({ orientation_degrees: 90, orientation_confidence: 3 })).toBeNull();
    expect(orientationTurns({ orientation_degrees: 45, orientation_confidence: 20 })).toBeNull();
    expect(orientationTurns({ orientation_degrees: null, orientation_confidence: null })).toBeNull();
    expect(orientationTurns({ orientation_degrees: 0, orientation_confidence: 20 })).toBe(0);
  });
});

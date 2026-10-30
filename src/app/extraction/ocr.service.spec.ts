import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrService } from './ocr.service';
import { orientationHint } from './orientation';

const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: mocks.createWorker } }));

describe('orientation before text recognition', () => {
  const detect = vi.fn(), recognize = vi.fn();
  const good = { confidence: 95, blocks: [{ paragraphs: [{ lines: [{ bbox: { x0: 0, y0: 0, x1: 80, y1: 20 },
    words: [{ text: 'SyntheticReport'.repeat(10), confidence: 95, bbox: { x0: 0, y0: 0, x1: 80, y1: 20 } }] }] }] }] };
  const poor = { confidence: 20, blocks: [] };
  const canvasOf = (width = 2200, height = 1600) => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
  };
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
  it('validates a near-threshold hint with one full read instead of discarding it', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 270, orientation_confidence: 9.99 } });
    const input = canvasOf();
    const result = await new OcrService().recognizeUpright(input, 0);
    expect(recognize).toHaveBeenCalledTimes(1);
    expect(result.canvas.width).toBe(1600); expect(result.canvas.height).toBe(2200);
    expect(input.width).toBe(2200);
  });
  it('rejects a wrong weak hint and stops after verifying the original angle', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 90, orientation_confidence: 3 } });
    recognize.mockResolvedValueOnce({ data: poor }).mockResolvedValueOnce({ data: poor })
      .mockResolvedValueOnce({ data: good }).mockResolvedValueOnce({ data: good });
    const input = canvasOf();
    const result = await new OcrService().recognizeUpright(input, 0);
    expect(recognize).toHaveBeenCalledTimes(4);
    expect(result.canvas).toBe(input);
    expect(recognize.mock.calls[0][0].width).toBe(0); // Discarded full-size rotation released.
    expect(recognize.mock.calls[1][0].width).toBe(0); // Discarded probe released.
    expect(input.width).toBe(2200);
  });
  it('stops angle search at a good reading without reading the remaining angles', async () => {
    detect.mockRejectedValue(new Error('Orientation unavailable'));
    recognize.mockResolvedValueOnce({ data: poor }).mockResolvedValueOnce({ data: poor })
      .mockResolvedValueOnce({ data: good }).mockResolvedValueOnce({ data: good });
    const input = canvasOf();
    const result = await new OcrService().recognizeUpright(input, 0);
    expect(recognize).toHaveBeenCalledTimes(4); // First, baseline, first alternative, final.
    expect(result.canvas.width).toBe(1600); expect(result.canvas.height).toBe(2200);
    expect(recognize.mock.calls[1][0].width).toBe(0);
    expect(recognize.mock.calls[2][0].width).toBe(0);
    expect(input.width).toBe(2200);
  });
  it('does not move progress backwards when another angle needs a full read', async () => {
    detect.mockRejectedValue(new Error('Orientation unavailable'));
    let call = 0;
    recognize.mockImplementation(async () => {
      const options = mocks.createWorker.mock.calls.find(([language]) => language !== 'osd')![2];
      options.logger({ status: 'recognizing text', progress: 0 });
      options.logger({ status: 'recognizing text', progress: 1 });
      return { data: ++call <= 2 ? poor : good };
    });
    const progress: number[] = [];
    await new OcrService().recognizeUpright(canvasOf(), 0, (value) => progress.push(value));
    expect(progress.at(-1)).toBe(1);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });
  it('reuses full-resolution readings for small pages', async () => {
    detect.mockRejectedValue(new Error('Orientation unavailable'));
    recognize.mockResolvedValueOnce({ data: poor }).mockResolvedValueOnce({ data: good });
    const result = await new OcrService().recognizeUpright(canvasOf(1000, 700), 0);
    expect(recognize).toHaveBeenCalledTimes(2);
    expect(result.canvas.width).toBe(700); expect(result.canvas.height).toBe(1000);
  });
  it('does not search other angles when a smaller reading confirms a strong hint', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 0, orientation_confidence: 15 } });
    recognize.mockResolvedValueOnce({ data: poor }).mockResolvedValueOnce({ data: good });
    const input = canvasOf();
    expect((await new OcrService().recognizeUpright(input, 0)).canvas).toBe(input);
    expect(recognize).toHaveBeenCalledTimes(2);
  });
  it('keeps the original orientation when a weak hint cannot be validated on sparse text', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 270, orientation_confidence: 3 } });
    recognize.mockResolvedValue({ data: poor });
    const input = canvasOf();
    expect((await new OcrService().recognizeUpright(input, 0)).canvas).toBe(input);
    expect(recognize).toHaveBeenCalledTimes(6);
    expect(recognize.mock.calls[0][0].width).toBe(0);
  });
  it('keeps searching if a promising probe fails full-resolution validation', async () => {
    detect.mockRejectedValue(new Error('Orientation unavailable'));
    recognize.mockResolvedValueOnce({ data: poor }).mockResolvedValueOnce({ data: poor })
      .mockResolvedValueOnce({ data: good }).mockResolvedValueOnce({ data: poor })
      .mockResolvedValueOnce({ data: good }).mockResolvedValueOnce({ data: good });
    const result = await new OcrService().recognizeUpright(canvasOf(), 0);
    expect(recognize).toHaveBeenCalledTimes(6);
    expect(result.words.length).toBe(1);
    expect(result.canvas).toBe(recognize.mock.calls[5][0]);
  });
  it('keeps a weak hinted rotation when it is the best reading even below the confidence threshold', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 270, orientation_confidence: 1.57 } });
    const readable = { ...good, confidence: 67 };
    recognize.mockResolvedValue({ data: poor })
      .mockResolvedValueOnce({ data: readable })
      .mockResolvedValueOnce({ data: { ...readable, confidence: 71 } });
    const result = await new OcrService().recognizeUpright(canvasOf(), 0);
    expect(recognize).toHaveBeenCalledTimes(6);
    expect(result.canvas).toBe(recognize.mock.calls[0][0]);
    expect(result.canvas.width).toBe(1600); expect(result.canvas.height).toBe(2200);
    expect(result.words[0].text).toBe(good.blocks[0].paragraphs[0].lines[0].words[0].text);
  });
  it('releases intermediate images on an OCR failure without clearing the caller image', async () => {
    detect.mockResolvedValue({ data: { orientation_degrees: 90, orientation_confidence: 15 } });
    recognize.mockRejectedValue(new Error('OCR failed'));
    const input = canvasOf();
    await expect(new OcrService().recognizeUpright(input, 0)).rejects.toThrow('OCR failed');
    expect(recognize.mock.calls[0][0].width).toBe(0);
    expect(input.width).toBe(2200);
  });
  it('rejects invalid angles and scores, and distinguishes hints from confident orientations', () => {
    expect(orientationHint({ orientation_degrees: 90, orientation_confidence: 3 })).toEqual({ turns: 1, confident: false });
    expect(orientationHint({ orientation_degrees: 45, orientation_confidence: 20 })).toBeNull();
    expect(orientationHint({ orientation_degrees: null, orientation_confidence: null })).toBeNull();
    expect(orientationHint({ orientation_degrees: 0, orientation_confidence: 0 })).toBeNull();
    expect(orientationHint({ orientation_degrees: 90, orientation_confidence: NaN })).toBeNull();
    expect(orientationHint({ orientation_degrees: 0, orientation_confidence: 20 })).toEqual({ turns: 0, confident: true });
  });
});

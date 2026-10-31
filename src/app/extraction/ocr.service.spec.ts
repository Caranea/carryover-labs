import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OcrService } from './ocr.service';
const mocks = vi.hoisted(() => ({ createWorker: vi.fn() }));
vi.mock('tesseract.js', () => ({ default: { createWorker: mocks.createWorker } }));
describe('privacy-only OCR', () => {
  const recognize = vi.fn(),
    detect = vi.fn();
  beforeEach(() => {
    recognize.mockReset();
    detect.mockReset();
    mocks.createWorker.mockReset().mockResolvedValue({ recognize, detect, terminate: vi.fn() });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      drawImage: vi.fn(),
    } as never);
  });
  afterEach(() => vi.restoreAllMocks());
  it.each([0, 90, 180, 270])(
    'does one pass with no detection/rotation for a %s degree page, including unreadable output',
    async (angle) => {
      const canvas = document.createElement('canvas');
      canvas.width = angle % 180 ? 1200 : 1800;
      canvas.height = angle % 180 ? 1800 : 1200;
      recognize.mockResolvedValue({ data: { confidence: 5, blocks: [] } });
      const service = new OcrService();
      expect((await service.recognizePage(canvas, 0)).canvas).toBe(canvas);
      expect(recognize).toHaveBeenCalledExactlyOnceWith(
        canvas,
        { rotateAuto: false },
        { blocks: true, text: false },
      );
      expect(detect).not.toHaveBeenCalled();
      expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    },
  );
  it('maps OCR boxes back to the full-resolution original without changing the original canvas', async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4000;
    canvas.height = 3000;
    recognize.mockResolvedValue({
      data: {
        blocks: [
          {
            paragraphs: [
              {
                lines: [
                  {
                    bbox: { x0: 10, y0: 20, x1: 100, y1: 40 },
                    words: [
                      {
                        text: 'Synthetic',
                        confidence: 99,
                        bbox: { x0: 10, y0: 20, x1: 100, y1: 40 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    const result = await new OcrService().recognizePage(canvas, 7);
    expect(result.words[0]).toMatchObject({ id: 7, box: { x: 20, y: 40, w: 180, h: 40 } });
    expect([canvas.width, canvas.height]).toEqual([4000, 3000]);
    expect(recognize).toHaveBeenCalledTimes(1);
  });
});

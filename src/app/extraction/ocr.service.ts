import { Injectable } from '@angular/core';
import type Tesseract from 'tesseract.js';
import { ASSETS, assetUrl, OCR_LANGUAGES } from '../core/assets';
import { WorkingWord } from '../core/models';
import { pageToWords, readingScore, readsWell } from './ocr-layout';
export { pageToWords, readingScore } from './ocr-layout';

export type OcrSource = HTMLCanvasElement | OffscreenCanvas | Blob | ImageBitmap;

/**
 * On-device OCR with tesseract.js. One worker is kept alive and reused; the
 * engine, the WASM core and the language data are served by this app.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  private worker: Promise<Tesseract.Worker> | null = null;
  private onProgress: ((p: number) => void) | null = null;

  async recognize(
    image: OcrSource,
    startId: number,
    onProgress?: (p: number) => void,
  ): Promise<WorkingWord[]> {
    const data = await this.run(image, onProgress);
    return pageToWords(data, startId);
  }

  /**
   * OCR a page that may have been photographed sideways or upside down.
   * When the first pass reads poorly, a quick low-resolution pass is made in
   * each orientation and the page is turned to the one that reads best.
   * Returns the canvas actually used, so word boxes match the page image.
   */
  async recognizeUpright(
    canvas: HTMLCanvasElement,
    startId: number,
    onProgress?: (p: number, message?: string) => void,
  ): Promise<{ words: WorkingWord[]; canvas: HTMLCanvasElement }> {
    const first = await this.run(canvas, (p) => onProgress?.(p * 0.6));
    if (readsWell(first)) {
      onProgress?.(1);
      return { words: pageToWords(first, startId), canvas };
    }

    onProgress?.(0.6, 'Checking which way up the page is');
    const small = scaled(canvas, 1600);
    const scores: number[] = [];
    for (const turn of [0, 1, 2, 3] as const) {
      const probe = turn === 0 ? small : rotated(small, turn);
      scores.push(readingScore(await this.run(probe)));
      onProgress?.(0.6 + (turn + 1) * 0.06, 'Checking which way up the page is');
    }
    const best = scores.indexOf(Math.max(...scores)) as 0 | 1 | 2 | 3;
    if (best === 0 || scores[best] < scores[0] * 1.3 + 5) {
      onProgress?.(1);
      return { words: pageToWords(first, startId), canvas };
    }

    const upright = rotated(canvas, best);
    const label = 'Recognising text';
    const data = await this.run(upright, (p) => onProgress?.(0.85 + p * 0.15, label));
    return { words: pageToWords(data, startId), canvas: upright };
  }

  private async run(image: OcrSource, onProgress?: (p: number) => void): Promise<Tesseract.Page> {
    const worker = await this.getWorker();
    this.onProgress = onProgress ?? null;
    try {
      const input = image instanceof ImageBitmap ? bitmapToCanvas(image) : image;
      const { data } = await worker.recognize(input as Tesseract.ImageLike, {}, { blocks: true, text: false });
      return data;
    } finally {
      this.onProgress = null;
    }
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await (await worker).terminate();
  }

  private getWorker(): Promise<Tesseract.Worker> {
    if (this.worker) return this.worker;
    const langs = OCR_LANGUAGES;
    this.worker = import('tesseract.js').then((mod) => {
      // CommonJS package: the API is on the default export when bundled.
      const { createWorker } = (mod.default ?? mod) as typeof Tesseract;
      return createWorker(langs, 1 as Tesseract.OEM /* LSTM only */, {
        workerPath: assetUrl(ASSETS.tesseractWorker),
        corePath: assetUrl(ASSETS.tesseractCore),
        langPath: assetUrl(ASSETS.tessdata),
        workerBlobURL: false,
        gzip: true,
        logger: (m) => {
          if (m.status === 'recognizing text') this.onProgress?.(m.progress);
        },
      });
    });
    this.worker.catch(() => {
      this.worker = null;
    });
    return this.worker;
  }
}

function scaled(canvas: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const s = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const out = document.createElement('canvas');
  out.width = Math.round(canvas.width * s);
  out.height = Math.round(canvas.height * s);
  out.getContext('2d')!.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

/** Rotate clockwise by 90° × turns. */
function rotated(canvas: HTMLCanvasElement, turns: 1 | 2 | 3): HTMLCanvasElement {
  const out = document.createElement('canvas');
  const swap = turns % 2 === 1;
  out.width = swap ? canvas.height : canvas.width;
  out.height = swap ? canvas.width : canvas.height;
  const ctx = out.getContext('2d')!;
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((turns * Math.PI) / 2);
  ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
  return out;
}

function bitmapToCanvas(bitmap: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
  return canvas;
}

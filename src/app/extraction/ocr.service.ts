import { Injectable, signal } from '@angular/core';
import type Tesseract from 'tesseract.js';
import { ASSETS, assetUrl, OCR_LANGUAGES } from '../core/assets';
import { WorkingWord } from '../core/models';
import { pageToWords, readingScore, readsWell } from './ocr-layout';
import { orientationTurns } from './orientation';
export { pageToWords, readingScore } from './ocr-layout';

export type OcrSource = HTMLCanvasElement | OffscreenCanvas | Blob | ImageBitmap;

/**
 * On-device OCR with tesseract.js. One worker is kept alive and reused; the
 * engine, the WASM core and the language data are served by this app.
 */
@Injectable({ providedIn: 'root' })
export class OcrService {
  readonly timings = signal<number[]>([]);
  private worker: Promise<Tesseract.Worker> | null = null;
  private orientationWorker: Promise<Tesseract.Worker | null> | null = null;
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
   * Detect orientation before recognising text. Retain the reading-quality
   * fallback when orientation is uncertain or the corrected text reads poorly.
   * Returns the canvas actually used, so word boxes match the page image.
   */
  async recognizeUpright(
    canvas: HTMLCanvasElement,
    startId: number,
    onProgress?: (p: number, message?: string) => void,
  ): Promise<{ words: WorkingWord[]; canvas: HTMLCanvasElement }> {
    const started = performance.now();
    const result = await this.recognizeOriented(canvas, startId, onProgress);
    if (result.words.length >= 100) this.timings.update(values => [...values.slice(-5), performance.now() - started]);
    return result;
  }

  private async recognizeOriented(
    canvas: HTMLCanvasElement,
    startId: number,
    onProgress?: (p: number, message?: string) => void,
  ): Promise<{ words: WorkingWord[]; canvas: HTMLCanvasElement }> {
    onProgress?.(0, 'Checking which way up the page is');
    const turns = await this.detectOrientation(canvas);
    if (turns) canvas = rotated(canvas, turns);
    const first = await this.run(canvas, (p) => onProgress?.(0.05 + p * 0.55, 'Recognising text'));
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
      const input = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ? bitmapToCanvas(image) : image;
      const { data } = await worker.recognize(input as Tesseract.ImageLike, {}, { blocks: true, text: false });
      return data;
    } finally {
      this.onProgress = null;
    }
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    const orientationWorker = this.orientationWorker;
    this.worker = null;
    this.orientationWorker = null;
    if (worker) await (await worker).terminate();
    if (orientationWorker) await (await orientationWorker)?.terminate();
  }

  private async detectOrientation(canvas: HTMLCanvasElement): Promise<0 | 1 | 2 | 3 | null> {
    this.orientationWorker ??= import('tesseract.js').then((mod) => {
      const { createWorker } = (mod.default ?? mod) as typeof Tesseract;
      // OSD needs the legacy core and its own small language data. The actual
      // multilingual recogniser remains LSTM-only and keeps its existing data.
      return createWorker('osd', 0 as Tesseract.OEM, {
        workerPath: assetUrl(ASSETS.tesseractWorker),
        corePath: assetUrl(ASSETS.tesseractCore),
        langPath: assetUrl(ASSETS.tessdata),
        workerBlobURL: false, gzip: true,
      });
    }).catch(() => null);
    try {
      const worker = await this.orientationWorker;
      if (!worker) return null;
      return orientationTurns((await worker.detect(canvas)).data);
    } catch {
      // A blank/sparse page or unavailable orientation data must not block OCR.
      return null;
    }
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

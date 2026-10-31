import { Injectable, signal } from '@angular/core';
import type Tesseract from 'tesseract.js';
import { ASSETS, assetUrl, OCR_LANGUAGES } from '../core/assets';
import { WorkingWord } from '../core/models';
import { pageToWords } from './ocr-layout';
export { pageToWords, readingScore } from './ocr-layout';

export type OcrSource = HTMLCanvasElement | OffscreenCanvas | Blob | ImageBitmap;

/** One bounded-resolution OCR pass for privacy boxes. Never rotates or retries a page. */
@Injectable({ providedIn: 'root' })
export class OcrService {
  readonly timings = signal<number[]>([]);
  private worker: Promise<Tesseract.Worker> | null = null;
  private onProgress: ((p: number) => void) | null = null;

  async recognize(
    image: OcrSource,
    startId: number,
    onProgress?: (p: number) => void,
  ): Promise<WorkingWord[]> {
    const worker = await this.getWorker();
    this.onProgress = onProgress ?? null;
    try {
      const { data } = await worker.recognize(
        image as Tesseract.ImageLike,
        { rotateAuto: false },
        { blocks: true, text: false },
      );
      return pageToWords(data, startId);
    } finally {
      this.onProgress = null;
    }
  }

  async recognizePage(
    canvas: HTMLCanvasElement,
    startId: number,
    onProgress?: (p: number, message?: string) => void,
  ) {
    const started = performance.now();
    const scale = Math.min(1, 2000 / Math.max(canvas.width, canvas.height));
    const input = scale === 1 ? canvas : document.createElement('canvas');
    if (input !== canvas) {
      input.width = Math.round(canvas.width * scale);
      input.height = Math.round(canvas.height * scale);
      input.getContext('2d')!.drawImage(canvas, 0, 0, input.width, input.height);
    }
    try {
      const words = await this.recognize(input, startId, onProgress);
      const sx = canvas.width / input.width,
        sy = canvas.height / input.height;
      for (const word of words)
        if (word.box)
          word.box = {
            x: word.box.x * sx,
            y: word.box.y * sy,
            w: word.box.w * sx,
            h: word.box.h * sy,
          };
      const elapsedMs = Math.round(performance.now() - started);
      this.timings.update((values) => [...values.slice(-5), elapsedMs]);
      console.info('[Carryover timing]', {
        stage: 'local-ocr',
        runId: crypto.randomUUID(),
        elapsedMs,
        words: words.length,
        passes: 1,
      });
      return { words, canvas };
    } finally {
      if (input !== canvas) input.width = input.height = 0;
    }
  }

  async terminate(): Promise<void> {
    const worker = this.worker;
    this.worker = null;
    if (worker) await (await worker).terminate();
  }

  private getWorker(): Promise<Tesseract.Worker> {
    if (this.worker) return this.worker;
    this.worker = import('tesseract.js').then((mod) => {
      const { createWorker } = (mod.default ?? mod) as typeof Tesseract;
      return createWorker(OCR_LANGUAGES, 1 as Tesseract.OEM, {
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

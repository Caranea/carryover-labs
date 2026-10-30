import { Injectable, signal } from '@angular/core';
import type Tesseract from 'tesseract.js';
import { ASSETS, assetUrl, OCR_LANGUAGES } from '../core/assets';
import { WorkingWord } from '../core/models';
import { pageToWords, readingScore, readsWell } from './ocr-layout';
import { orientationHint, OrientationHint } from './orientation';
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
   * Try the orientation hint first and validate it with readable text. Only
   * search other angles when necessary, stopping at a verified good reading.
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
    let fraction = 0;
    const progress = (value: number, message?: string) => {
      fraction = Math.max(fraction, value);
      onProgress?.(fraction, message);
    };
    progress(0, 'Checking which way up the page is');
    const hint = await this.detectOrientation(canvas);
    type Turns = OrientationHint['turns'];
    type Reading = { data: Tesseract.Page; canvas: HTMLCanvasElement };
    const temporary = new Set<HTMLCanvasElement>();
    const full = new Map<Turns, Reading>();
    let kept = canvas;
    const turned = (source: HTMLCanvasElement, turn: Turns) => {
      if (!turn) return source;
      const image = rotated(source, turn); temporary.add(image); return image;
    };
    const readFull = async (turn: Turns): Promise<Reading> => {
      const cached = full.get(turn);
      if (cached) return cached;
      const image = turned(canvas, turn);
      const data = await this.run(image, (p) => progress(0.05 + p * 0.55, 'Recognising text'));
      const reading = { data, canvas: image }; full.set(turn, reading); return reading;
    };
    const finish = (reading: Reading) => {
      const words = pageToWords(reading.data, startId);
      progress(1);
      kept = reading.canvas;
      return { words, canvas: kept };
    };
    const improves = (candidate: Tesseract.Page, baseline: Tesseract.Page) =>
      (readsWell(candidate) && !readsWell(baseline)) || readingScore(candidate) >= readingScore(baseline) * 1.3 + 5;
    try {
      const initialTurn = hint?.turns ?? 0;
      const first = await readFull(initialTurn);
      if (readsWell(first.data)) return finish(first);

      // All angle comparisons use the same resolution. Small pages reuse the
      // full reading, and an upright small reading avoids needless angle scans.
      const small = Math.max(canvas.width, canvas.height) <= 1600 ? canvas : scaled(canvas, 1600);
      if (small !== canvas) temporary.add(small);
      const probe = async (turn: Turns): Promise<Tesseract.Page> => {
        if (small === canvas) return (await readFull(turn)).data;
        const image = turned(small, turn);
        try { return await this.run(image); }
        finally {
          if (image !== small) { image.width = image.height = 0; temporary.delete(image); }
        }
      };
      const baseline = await probe(initialTurn);
      // A weak OSD hint must also be confirmed at full resolution; it cannot
      // rotate a sparse/unreadable page solely on its orientation score.
      if (readsWell(baseline) && (!initialTurn || hint?.confident)) return finish(first);
      let bestTurn = initialTurn;
      let bestData = baseline;
      for (const turn of [0, 1, 3, 2] as const) {
        if (turn === initialTurn) continue;
        progress(0.6, 'Checking which way up the page is');
        const data = await probe(turn);
        if (readingScore(data) > readingScore(bestData)) { bestData = data; bestTurn = turn; }
        if (readsWell(data) && improves(data, baseline)) {
          const candidate = await readFull(turn);
          if (readsWell(candidate.data) && improves(candidate.data, first.data)) return finish(candidate);
        }
      }
      // Keep the original angle when an uncertain hint could not be validated.
      const fallback = initialTurn && !hint?.confident ? await readFull(0) : first;
      // The hinted angle can still be the clear winner on a blurry page even
      // when no angle passes readsWell(). Compare it too; otherwise a weak but
      // correct hint is discarded solely because it was tried first.
      const candidate = await readFull(bestTurn);
      if (improves(candidate.data, fallback.data)) return finish(candidate);
      return finish(fallback);
    } finally {
      // Large rotated canvases otherwise accumulate until the browser runs GC.
      for (const image of temporary) if (image !== kept) image.width = image.height = 0;
    }
  }

  private async run(image: OcrSource, onProgress?: (p: number) => void): Promise<Tesseract.Page> {
    const worker = await this.getWorker();
    this.onProgress = onProgress ?? null;
    try {
      const input = typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ? bitmapToCanvas(image) : image;
      try {
        const { data } = await worker.recognize(input as Tesseract.ImageLike, {}, { blocks: true, text: false });
        return data;
      } finally {
        if (input !== image) (input as HTMLCanvasElement).width = (input as HTMLCanvasElement).height = 0;
      }
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

  private async detectOrientation(canvas: HTMLCanvasElement): Promise<OrientationHint | null> {
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
      return orientationHint((await worker.detect(canvas)).data);
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

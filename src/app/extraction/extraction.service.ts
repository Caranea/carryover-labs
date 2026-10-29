import { inject, Injectable, InjectionToken } from '@angular/core';
import { SourceKind, WorkingPage } from '../core/models';
import { isHeic, loadImage } from './image-extractor';
import { runsToWords, textToWords } from './layout';
import { OcrService } from './ocr.service';
import { canvasToBlob } from './render';
import { textLayerIsUsable } from './text-quality';
import { PdfPageLimitError } from './pdf-extractor';

export const MAX_FILE_BYTES = 40 * 1024 * 1024;
export const MAX_PAGES = 40;

export const ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.heic,.heif,.bmp,.gif,.tif,.tiff,.docx,.txt,.csv,' +
  'application/pdf,image/*,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv';

export interface ExtractionProgress {
  (fraction: number, message: string): void;
}

export class UnsupportedFileError extends Error {}

/** Browser resources are injectable so failure cleanup can be checked without real OCR or decoding. */
export const EXTRACTION_IO = new InjectionToken<{
  readPdf: typeof import('./pdf-extractor').readPdf;
  loadImage: typeof loadImage;
  canvasToBlob: typeof canvasToBlob;
}>('EXTRACTION_IO', { providedIn: 'root', factory: () => ({
  async *readPdf(file, maxPages) { const { readPdf } = await import('./pdf-extractor'); yield* readPdf(file, maxPages); },
  loadImage,
  canvasToBlob,
}) });

export function sourceKindOf(file: File): SourceKind | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || isHeic(file) || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/.test(name)) return 'image';
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return 'docx';
  if (type.startsWith('text/') || /\.(txt|csv)$/.test(name)) return 'text';
  return null;
}

/**
 * Turns any supported file into pages of positioned words, entirely in the
 * browser. Images and scanned PDF pages go through OCR; PDFs with a text layer
 * use it directly.
 */
@Injectable({ providedIn: 'root' })
export class ExtractionService {
  private readonly ocr = inject(OcrService);
  private readonly io = inject(EXTRACTION_IO);

  async extract(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    if (file.size > MAX_FILE_BYTES) {
      throw new UnsupportedFileError('This file is larger than 40 MB. Split it or export the pages as images.');
    }
    const kind = sourceKindOf(file);
    if (/\.doc$/i.test(file.name)) {
      throw new UnsupportedFileError('Old Word files (.doc) are not supported. Save it as .docx or PDF and add it again.');
    }
    switch (kind) {
      case 'pdf':
        return this.fromPdf(file, progress);
      case 'image':
        return this.fromImage(file, progress);
      case 'docx':
        return this.fromDocx(file, progress);
      case 'text':
        return this.fromText(file, progress);
      default:
        throw new UnsupportedFileError('This file type is not supported. Use PDF, a photo, Word (.docx) or text.');
    }
  }

  private async fromPdf(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    const pages: WorkingPage[] = [];
    let nextId = 0;
    progress(0, 'Opening PDF');

    try {
      for await (const page of this.io.readPdf(file, MAX_PAGES)) {
        let canvas = page.canvas;
        try {
          if (page.pageCount > MAX_PAGES || page.index >= MAX_PAGES) {
            throw new UnsupportedFileError(`This PDF has more than ${MAX_PAGES} pages. Split it into smaller files.`);
          }
          const base = page.index / page.pageCount;
          const span = 1 / page.pageCount;
          let words;
          let ocr = false;
          let image = page.image;
          // Many lab PDFs have a scrambled or missing text layer; read those pages with OCR.
          if (textLayerIsUsable(page.runs.map((r) => r.text).join(' '))) {
            progress(base, `Reading page ${page.index + 1} of ${page.pageCount}`);
            words = runsToWords(page.runs, nextId);
          } else {
            ocr = true;
            const label = `Recognising text on page ${page.index + 1} of ${page.pageCount}`;
            progress(base, label);
            const result = await this.ocr.recognizeUpright(page.canvas, nextId, (p, msg) =>
              progress(base + span * p, msg ?? label),
            );
            words = result.words;
            if (result.canvas !== page.canvas) {
              canvas = result.canvas;
              image = await this.io.canvasToBlob(canvas);
            }
          }
          nextId += words.length;
          pages.push({
            index: page.index,
            width: canvas.width,
            height: canvas.height,
            image,
            imageUrl: URL.createObjectURL(image),
            words,
            regions: [],
            ocr,
          });
        } finally {
          page.canvas.width = page.canvas.height = 0;
          if (canvas !== page.canvas) canvas.width = canvas.height = 0;
        }
      }
    } catch (error) {
      // The queue never receives a partial import, so it cannot release these previews.
      for (const page of pages) if (page.imageUrl) URL.revokeObjectURL(page.imageUrl);
      if (error instanceof PdfPageLimitError) throw new UnsupportedFileError(error.message);
      throw error;
    }
    return pages;
  }

  private async fromImage(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    progress(0, 'Opening image');
    const loaded = await this.io.loadImage(file);
    let canvas = loaded;
    try {
      progress(0.02, 'Recognising text');
      const result = await this.ocr.recognizeUpright(loaded, 0, (p, msg) =>
        progress(p, msg ?? 'Recognising text'),
      );
      canvas = result.canvas;
      const image = await this.io.canvasToBlob(canvas);
      return [{
        index: 0,
        width: canvas.width,
        height: canvas.height,
        image,
        imageUrl: URL.createObjectURL(image),
        words: result.words,
        regions: [],
        ocr: true,
      }];
    } finally {
      loaded.width = loaded.height = 0;
      if (canvas !== loaded) canvas.width = canvas.height = 0;
    }
  }

  private async fromDocx(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    progress(0, 'Reading Word document');
    const mod = await import('mammoth');
    const mammoth = (mod.default ?? mod) as typeof mod;
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return [textPage(value)];
  }

  private async fromText(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    progress(0, 'Reading text');
    // Split CSV cells into separate words, but keep decimal commas ("13,2") intact.
    const text = (await file.text()).replace(/\t/g, '  ').replace(/;|(?<!\d),|,(?!\d)/g, (c) => `${c} `);
    return [textPage(text)];
  }
}

function textPage(text: string): WorkingPage {
  const words = textToWords(text);
  if (!words.length) throw new UnsupportedFileError('This file has no text in it.');
  return { index: 0, width: 0, height: 0, image: null, imageUrl: null, words, regions: [], ocr: false };
}

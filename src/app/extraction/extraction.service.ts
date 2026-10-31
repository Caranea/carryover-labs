import { inject, Injectable, InjectionToken } from '@angular/core';
import { SourceKind, WorkingPage } from '../core/models';
import { isHeic, loadImage } from './image-extractor';
import { OcrService } from './ocr.service';
import { canvasToBlob, createCanvas } from './render';
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
}>('EXTRACTION_IO', {
  providedIn: 'root',
  factory: () => ({
    async *readPdf(file, maxPages) {
      const { readPdf } = await import('./pdf-extractor');
      yield* readPdf(file, maxPages);
    },
    loadImage,
    canvasToBlob,
  }),
});

export function sourceKindOf(file: File): SourceKind | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('image/') || isHeic(file) || /\.(jpe?g|png|webp|bmp|gif|tiff?)$/.test(name))
    return 'image';
  if (name.endsWith('.docx') || type.includes('wordprocessingml')) return 'docx';
  if (type.startsWith('text/') || /\.(txt|csv)$/.test(name)) return 'text';
  return null;
}

/**
 * Turns any supported file into pages of positioned words, entirely in the
 * browser. Every rendered page gets one OCR pass for privacy detection only.
 */
@Injectable({ providedIn: 'root' })
export class ExtractionService {
  private readonly ocr = inject(OcrService);
  private readonly io = inject(EXTRACTION_IO);

  async extract(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    if (file.size > MAX_FILE_BYTES) {
      throw new UnsupportedFileError(
        'This file is larger than 40 MB. Split it or export the pages as images.',
      );
    }
    const kind = sourceKindOf(file);
    if (/\.doc$/i.test(file.name)) {
      throw new UnsupportedFileError(
        'Old Word files (.doc) are not supported. Save it as .docx or PDF and add it again.',
      );
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
        throw new UnsupportedFileError(
          'This file type is not supported. Use PDF, a photo, Word (.docx) or text.',
        );
    }
  }

  private async fromPdf(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    const pages: WorkingPage[] = [];
    let nextId = 0;
    progress(0, 'Opening PDF');

    try {
      for await (const page of this.io.readPdf(file, MAX_PAGES)) {
        const canvas = page.canvas;
        try {
          if (page.pageCount > MAX_PAGES || page.index >= MAX_PAGES) {
            throw new UnsupportedFileError(
              `This PDF has more than ${MAX_PAGES} pages. Split it into smaller files.`,
            );
          }
          const base = page.index / page.pageCount;
          const span = 1 / page.pageCount;
          const label = `Privacy checking page ${page.index + 1} of ${page.pageCount}`;
          const result = await this.ocr.recognizePage(page.canvas, nextId, (p, msg) =>
            progress(base + span * p, msg ?? label),
          );
          const words = result.words;
          const image = page.image;
          const ocr = true;
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
      const result = await this.ocr.recognizePage(loaded, 0, (p, msg) =>
        progress(p, msg ?? 'Recognising text'),
      );
      canvas = result.canvas;
      const image = await this.io.canvasToBlob(canvas);
      return [
        {
          index: 0,
          width: canvas.width,
          height: canvas.height,
          image,
          imageUrl: URL.createObjectURL(image),
          words: result.words,
          regions: [],
          ocr: true,
        },
      ];
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
    return this.fromTextContent(value, progress);
  }

  private async fromText(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    progress(0, 'Reading text');
    // Split CSV cells into separate words, but keep decimal commas ("13,2") intact.
    const text = (await file.text())
      .replace(/\t/g, '  ')
      .replace(/;|(?<!\d),|,(?!\d)/g, (c) => `${c} `);
    return this.fromTextContent(text, progress);
  }
  private async fromTextContent(
    text: string,
    progress: ExtractionProgress,
  ): Promise<WorkingPage[]> {
    if (!text.trim()) throw new UnsupportedFileError('This file has no text in it.');
    // Render text-only imports into visible pages too; the server receives pixels only.
    const canvas = createCanvas(1400, 1900);
    const ctx = canvas.getContext('2d')!;
    ctx.font = '24px sans-serif';
    const lines: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const char of paragraph) {
        if (ctx.measureText(line + char).width > 1280) {
          lines.push(line);
          line = '';
        }
        line += char;
      }
      lines.push(line);
    }
    if (lines.length > 50 * MAX_PAGES)
      throw new UnsupportedFileError('This file has too many pages. Split it into smaller files.');
    const pages: WorkingPage[] = [];
    let nextId = 0;
    try {
      for (let offset = 0; offset < lines.length; offset += 50) {
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        lines.slice(offset, offset + 50).forEach((line, i) => ctx.fillText(line, 60, 70 + i * 35));
        const { words } = await this.ocr.recognizePage(canvas, nextId, (p) =>
          progress((offset + 50 * p) / lines.length, 'Privacy checking text'),
        );
        nextId += words.length;
        const image = await this.io.canvasToBlob(canvas);
        pages.push({
          index: pages.length,
          width: canvas.width,
          height: canvas.height,
          words,
          image,
          imageUrl: URL.createObjectURL(image),
          regions: [],
          ocr: true,
        });
      }
      return pages;
    } catch (error) {
      for (const page of pages) if (page.imageUrl) URL.revokeObjectURL(page.imageUrl);
      throw error;
    } finally {
      canvas.width = canvas.height = 0;
    }
  }
}

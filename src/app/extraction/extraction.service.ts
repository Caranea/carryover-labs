import { inject, Injectable, InjectionToken } from '@angular/core';
import { SourceKind, WorkingPage } from '../core/models';
import { isHeic, loadImage } from './image-extractor';
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

/** Browser resources are injectable so failure cleanup can be checked without real decoding. */
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
 * Turns any supported file into page images, entirely in the browser. Nothing reads the pages
 * here: the person covers personal details by hand before anything is sent.
 */
@Injectable({ providedIn: 'root' })
export class ExtractionService {
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

  /**
   * A sample patient document: its page images, opened like a photo. They come from this site,
   * so the browser starts from the same pixels the sample was recorded from.
   */
  async extractSample(
    pages: { src: string }[],
    progress: ExtractionProgress,
  ): Promise<WorkingPage[]> {
    const out: WorkingPage[] = [];
    try {
      for (const [index, { src }] of pages.entries()) {
        progress(index / pages.length, `Opening page ${index + 1} of ${pages.length}`);
        const response = await fetch(new URL(src, document.baseURI));
        if (!response.ok) throw new Error('The sample patient could not be loaded. Try again.');
        const blob = await response.blob();
        const canvas = await this.io.loadImage(
          new File([blob], src.split('/').pop()!, { type: blob.type }),
        );
        try {
          const image = await this.io.canvasToBlob(canvas);
          out.push(pageOf(index, canvas, image));
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      return out;
    } catch (error) {
      for (const page of out) if (page.imageUrl) URL.revokeObjectURL(page.imageUrl);
      throw error;
    }
  }

  private async fromPdf(file: File, progress: ExtractionProgress): Promise<WorkingPage[]> {
    const pages: WorkingPage[] = [];
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
          progress(
            page.index / page.pageCount,
            `Opening page ${page.index + 1} of ${page.pageCount}`,
          );
          pages.push(pageOf(page.index, canvas, page.image));
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
    const canvas = await this.io.loadImage(file);
    try {
      return [pageOf(0, canvas, await this.io.canvasToBlob(canvas))];
    } finally {
      canvas.width = canvas.height = 0;
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
    try {
      for (let offset = 0; offset < lines.length; offset += 50) {
        progress(offset / lines.length, 'Preparing text');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#000';
        lines.slice(offset, offset + 50).forEach((line, i) => ctx.fillText(line, 60, 70 + i * 35));
        pages.push(pageOf(pages.length, canvas, await this.io.canvasToBlob(canvas)));
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

/** A page ready for the person to cover personal details on. */
function pageOf(index: number, canvas: HTMLCanvasElement, image: Blob): WorkingPage {
  return {
    index,
    width: canvas.width,
    height: canvas.height,
    image,
    imageUrl: URL.createObjectURL(image),
    words: [],
    regions: [],
    ocr: false,
  };
}

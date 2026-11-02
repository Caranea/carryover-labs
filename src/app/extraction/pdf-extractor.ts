import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { ASSETS, assetUrl } from '../core/assets';
import { canvasToBlob, createCanvas, MAX_SIDE } from './render';

export interface RenderedPdfPage {
  index: number;
  canvas: HTMLCanvasElement;
  image: Blob;
}

const TARGET_WIDTH = 2000;

export class PdfPageLimitError extends Error {
  constructor(limit: number) {
    super(`This PDF has more than ${limit} pages. Split it into smaller files.`);
  }
}

/** Render each page; its borrowed canvas is released when the consumer advances or closes the iterator. */
export async function* readPdf(
  file: File,
  maxPages = Infinity,
): AsyncGenerator<RenderedPdfPage & { pageCount: number }> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = assetUrl(ASSETS.pdfWorker);

  const data = new Uint8Array(await file.arrayBuffer());
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // Scanned PDFs often use JBIG2 or JPEG 2000 images, which need pdf.js's WebAssembly decoders.
    wasmUrl: assetUrl(ASSETS.pdfWasm),
    cMapUrl: assetUrl(ASSETS.pdfCMaps),
    cMapPacked: true,
    standardFontDataUrl: assetUrl(ASSETS.pdfFonts),
    iccUrl: assetUrl(ASSETS.pdfIcc),
  });
  try {
    const doc = await task.promise;
    if (doc.numPages > maxPages) throw new PdfPageLimitError(maxPages);
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      let rendered: Omit<RenderedPdfPage, 'index'> | undefined;
      try {
        try {
          rendered = await renderPage(page);
        } finally {
          page.cleanup(); // release PDF caches before the consumer performs OCR
        }
        yield { ...rendered, index: i - 1, pageCount: doc.numPages };
      } finally {
        if (rendered) rendered.canvas.width = rendered.canvas.height = 0;
      }
    }
  } finally {
    await task.destroy();
  }
}

async function renderPage(page: PDFPageProxy): Promise<Omit<RenderedPdfPage, 'index'>> {
  const base = page.getViewport({ scale: 1 });
  let scale = Math.min(3, Math.max(1.5, TARGET_WIDTH / base.width));
  if (Math.max(base.width, base.height) * scale > MAX_SIDE * 1.2) {
    scale = (MAX_SIDE * 1.2) / Math.max(base.width, base.height);
  }
  const viewport = page.getViewport({ scale });

  const canvas = createCanvas(viewport.width, viewport.height);
  try {
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;

    // Ignore PDF text layers, including invisible text. Privacy detection uses the rendered pixels.
    return { canvas, image: await canvasToBlob(canvas) };
  } catch (error) {
    canvas.width = canvas.height = 0;
    throw error;
  }
}

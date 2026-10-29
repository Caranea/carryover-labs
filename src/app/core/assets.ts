/**
 * Everything the browser needs for on-device processing is served by this app
 * (see the "assets" section of angular.json). Nothing is fetched from a CDN,
 * so documents can be processed without any third party seeing the request.
 * The PII model itself is downloaded once from Hugging Face and cached by the
 * browser (it contains no user data).
 */
export const ASSETS = {
  pdfWorker: 'vendor/pdfjs/pdf.worker.min.mjs',
  /** pdf.js image decoders (JBIG2, JPEG 2000), character maps, fonts and colour profiles. */
  pdfWasm: 'vendor/pdfjs/wasm/',
  pdfCMaps: 'vendor/pdfjs/cmaps/',
  pdfFonts: 'vendor/pdfjs/standard_fonts/',
  pdfIcc: 'vendor/pdfjs/iccs/',
  tesseractWorker: 'vendor/tesseract/worker.min.js',
  tesseractCore: 'vendor/tesseract-core',
  tessdata: 'vendor/tessdata',
  ortWasm: 'vendor/ort/',
} as const;

export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

/** OCR always reads Polish, German and English. */
export const OCR_LANGUAGES = 'pol+deu+eng';

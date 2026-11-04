/**
 * Everything the browser needs for on-device processing is served by this app
 * (see the "assets" section of angular.json). Nothing is fetched from a CDN,
 * so documents can be processed without any third party seeing the request.
 */
export const ASSETS = {
  pdfWorker: 'vendor/pdfjs/pdf.worker.min.mjs',
  /** pdf.js image decoders (JBIG2, JPEG 2000), character maps, fonts and colour profiles. */
  pdfWasm: 'vendor/pdfjs/wasm/',
  pdfCMaps: 'vendor/pdfjs/cmaps/',
  pdfFonts: 'vendor/pdfjs/standard_fonts/',
  pdfIcc: 'vendor/pdfjs/iccs/',
} as const;

export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}

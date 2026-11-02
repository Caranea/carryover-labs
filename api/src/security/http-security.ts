import type { NextFunction, Request, Response } from 'express';

/**
 * What the app may load. Medical results sit in this browser's storage, so injected script
 * must not run. WebAssembly (OCR, the privacy model) needs 'wasm-unsafe-eval'; OCR and model
 * workers start from blob: URLs; the privacy model downloads from Hugging Face, whose files
 * redirect to *.hf.co. Angular adds component styles as <style> elements, hence inline styles.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.set({
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (req.path === '/api' || req.path.startsWith('/api/')) {
    res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  }
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

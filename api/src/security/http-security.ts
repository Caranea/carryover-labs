import type { NextFunction, Request, Response } from 'express';

/**
 * What the app may load. Medical results sit in this browser's storage, so injected script
 * must not run. WebAssembly (OCR, the privacy model) needs 'wasm-unsafe-eval'; OCR and model
 * workers start from blob: URLs; the privacy model downloads from Hugging Face, whose files
 * redirect to *.hf.co. Angular adds component styles as <style> elements, hence inline styles.
 * Google Analytics loads only after someone accepts it, from src/app/core/analytics.ts; its hosts
 * are Google's published list for GA4. Inline script stays blocked.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.google-analytics.com https://*.googletagmanager.com",
  "font-src 'self' data:",
  "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
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

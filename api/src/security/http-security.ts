import type { NextFunction, Request, Response } from 'express';
import { LIMITS } from '../documents/validate.js';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  if (req.path === '/api' || req.path.startsWith('/api/')) res.set({ 'Cache-Control': 'private, no-store', Pragma: 'no-cache' });
  if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
}

interface Window { expires: number; reads: number; writes: number; active: number }
/** Bounded, process-local abuse protection. A trusted gateway is still needed across replicas. */
export function requestLimits(options = { reads: 240, writes: 30, concurrentUploads: 4, windowMs: 60_000, maxClients: 10_000 }) {
  const windows = new Map<string, Window>();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/api/')) return next();
    const now = Date.now();
    if (windows.size >= options.maxClients) for (const [key, value] of windows) if (value.expires <= now && !value.active) windows.delete(key);
    // Do not trust client-supplied forwarding headers without an explicitly trusted proxy.
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let window = windows.get(key);
    if (!window || window.expires <= now) {
      if (!window && windows.size >= options.maxClients) { res.status(503).json({ message: 'The service is busy. Please try again shortly.' }); return; }
      window ??= { expires: now + options.windowMs, reads: 0, writes: 0, active: 0 };
      window.expires = now + options.windowMs;
      window.reads = 0;
      window.writes = 0;
      windows.set(key, window);
    }
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const upload = write && /^\/api\/documents(?:\/[^/]+)?$/.test(req.path);
    const count = write ? ++window.writes : ++window.reads;
    if (count > (write ? options.writes : options.reads) || (upload && window.active >= options.concurrentUploads)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((window.expires - now) / 1000))));
      res.status(429).json({ message: 'Too many requests at once. Wait a minute, then try again.' });
      return;
    }
    const length = Number(req.headers['content-length']);
    if (upload && Number.isFinite(length) && length > LIMITS.uploadBytes + LIMITS.manifestBytes + 1024 * 1024) {
      res.status(413).json({ message: 'This upload is too large. Add fewer pages at a time.' });
      return;
    }
    if (upload) {
      window.active++;
      let released = false;
      const release = () => { if (!released) { released = true; window!.active--; } };
      res.once('finish', release);
      res.once('close', release);
    }
    next();
  };
}

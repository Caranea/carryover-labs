import type { NextFunction, Request, Response } from 'express';

export function securityHeaders(req: Request, res: Response, next: NextFunction): void {
  res.set({
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

interface Window {
  expires: number;
  reads: number;
  writes: number;
}

// Writes cover one request per page (40-page batches); reads cover long polls of up to 25 s.
const DEFAULT_LIMITS = { reads: 240, writes: 120, windowMs: 60_000, maxClients: 10_000 };

/** Per-client request budget. Process-local; a gateway is still needed across replicas. */
export function requestLimits(limits = DEFAULT_LIMITS) {
  const windows = new Map<string, Window>();

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/api/')) return next();
    const now = Date.now();
    if (windows.size >= limits.maxClients) {
      for (const [key, value] of windows) if (value.expires <= now) windows.delete(key);
    }
    // Client-supplied forwarding headers are only trusted behind an explicitly trusted proxy.
    const key = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    let window = windows.get(key);
    if (!window || window.expires <= now) {
      if (!window && windows.size >= limits.maxClients) {
        res.status(503).json({ message: 'The service is busy. Please try again shortly.' });
        return;
      }
      window = { expires: now + limits.windowMs, reads: 0, writes: 0 };
      windows.set(key, window);
    }
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const count = write ? ++window.writes : ++window.reads;
    if (count > (write ? limits.writes : limits.reads)) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((window.expires - now) / 1000))));
      res
        .status(429)
        .json({ message: 'Too many requests at once. Wait a minute, then try again.' });
      return;
    }
    next();
  };
}

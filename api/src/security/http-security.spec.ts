import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { securityHeaders } from './http-security.js';

function request(method = 'GET'): Request {
  return {
    path: '/api/batches/b1/pages',
    ip: '127.0.0.1',
    socket: {},
    headers: {},
    method,
    secure: true,
  } as Request;
}
function response() {
  const headers = new Map<string, string>();
  let status = 200;
  const res = Object.assign(
    {},
    {
      set(name: string | Record<string, string>, value?: string) {
        if (typeof name === 'string') headers.set(name, value!);
        else Object.entries(name).forEach(([k, v]) => headers.set(k, v));
        return this;
      },
      status(value: number) {
        status = value;
        return this;
      },
      json(_value: unknown) {
        return this;
      },
    },
  );
  return { res: res as unknown as Response, headers, status: () => status };
}
describe('HTTP privacy headers', () => {
  it('prevents authenticated API caching and sets transport/browser protections', () => {
    const r = response();
    let next = false;
    securityHeaders(request(), r.res, () => {
      next = true;
    });
    assert.equal(next, true);
    assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(r.headers.get('Strict-Transport-Security'), 'max-age=31536000');
    const csp = r.headers.get('Content-Security-Policy') ?? '';
    assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'(;|$)/, 'no inline or remote script');
    assert.match(csp, /frame-ancestors 'none'/);
  });
});

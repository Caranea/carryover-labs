import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { describe, it } from 'node:test';
import type { Request, Response } from 'express';
import { requestLimits, securityHeaders } from './http-security.js';

function request(method = 'GET'): Request {
  return { path: '/api/documents', ip: '127.0.0.1', socket: {}, headers: {}, method, secure: true } as Request;
}
function response() {
  const headers = new Map<string, string>();
  let status = 200;
  const res = Object.assign(new EventEmitter(), {
    set(name: string | Record<string, string>, value?: string) { if (typeof name === 'string') headers.set(name, value!); else Object.entries(name).forEach(([k, v]) => headers.set(k, v)); return this; },
    status(value: number) { status = value; return this; },
    json(_value: unknown) { return this; },
  });
  return { res: res as unknown as Response, headers, status: () => status };
}
describe('HTTP privacy and resource limits', () => {
  it('prevents authenticated API caching and sets transport/browser protections', () => {
    const r = response(); let next = false;
    securityHeaders(request(), r.res, () => { next = true; });
    assert.equal(next, true);
    assert.equal(r.headers.get('Cache-Control'), 'private, no-store');
    assert.equal(r.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(r.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  });
  it('rejects excess reads with a retry time', () => {
    const limit = requestLimits({ reads: 1, writes: 1, concurrentUploads: 1, windowMs: 60_000, maxClients: 2 });
    let passed = 0;
    limit(request(), response().res, () => { passed++; });
    const blocked = response();
    limit(request(), blocked.res, () => { passed++; });
    assert.equal(passed, 1); assert.equal(blocked.status(), 429); assert.ok(blocked.headers.has('Retry-After'));
  });
  it('releases concurrent upload capacity once, including disconnected responses', () => {
    const limit = requestLimits({ reads: 10, writes: 10, concurrentUploads: 1, windowMs: 60_000, maxClients: 2 });
    const active = response();
    limit(request('POST'), active.res, () => {});
    const blocked = response(); limit(request('POST'), blocked.res, () => {});
    assert.equal(blocked.status(), 429);
    active.res.emit('close'); active.res.emit('finish');
    let passed = false;
    limit(request('POST'), response().res, () => { passed = true; });
    assert.equal(passed, true);
  });
});

import { HttpErrorResponse, HttpRequest, HttpResponse } from '@angular/common/http';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, Subject } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';

describe('session-bound API requests', () => {
  function setup() {
    let resolveToken!: (value: string) => void;
    const auth = { userId: signal<string | null>('owner-a'), sessionRevision: signal(1), token: vi.fn(() => new Promise<string>(resolve => { resolveToken = resolve; })) };
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }] });
    return { auth, resolveToken: (value = 'token-a') => resolveToken(value) };
  }
  it('does not submit a write with the next account token after a switch', async () => {
    const { auth, resolveToken } = setup();
    const next = vi.fn(() => of(new HttpResponse({ status: 200 })));
    const result = firstValueFrom(TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('POST', '/api/documents', {}), next))).catch(error => error);
    auth.userId.set('owner-b'); auth.sessionRevision.update(n => n + 1); resolveToken('token-b');
    expect(await result).toBeInstanceOf(HttpErrorResponse); expect(next).not.toHaveBeenCalled();
  });
  it('rejects a late reply even after switching back to the original account', async () => {
    const { auth, resolveToken } = setup();
    const response = new Subject<HttpResponse<unknown>>();
    const next = vi.fn((_request: HttpRequest<unknown>) => response);
    const result = firstValueFrom(TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/results'), next))).catch(error => error);
    resolveToken(); await Promise.resolve();
    expect(next.mock.calls[0][0].headers.get('Authorization')).toBe('Bearer token-a');
    auth.sessionRevision.update(n => n + 2); response.next(new HttpResponse({ body: { private: 'old result' } }));
    expect(await result).toBeInstanceOf(HttpErrorResponse);
  });
  it('leaves public configuration independent of sign-in', async () => {
    const { auth } = setup();
    const next = vi.fn(() => of(new HttpResponse({ status: 200 })));
    await firstValueFrom(TestBed.runInInjectionContext(() => authInterceptor(new HttpRequest('GET', '/api/config'), next)));
    expect(auth.token).not.toHaveBeenCalled(); expect(next).toHaveBeenCalledOnce();
  });
});

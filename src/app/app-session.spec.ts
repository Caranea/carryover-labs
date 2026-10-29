import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { AuthService } from './auth/auth.service';

describe('route ownership', () => {
  function setup(owner: string | null) {
    const auth = { userId: signal(owner), sessionRevision: signal(0), status: signal(owner ? 'signed-in' : 'signed-out'), unmountUserButton: vi.fn() };
    const router = { navigateByUrl: vi.fn(async () => true) };
    TestBed.configureTestingModule({ providers: [{ provide: AuthService, useValue: auth }, { provide: Router, useValue: router }] });
    TestBed.overrideComponent(App, { set: { template: '', imports: [] } });
    const fixture = TestBed.createComponent(App); fixture.detectChanges();
    return { auth, router, fixture };
  }
  it('re-runs guarded navigation when an established account changes or signs out', () => {
    const { auth, router, fixture } = setup('owner-a');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    auth.userId.set('owner-b'); auth.sessionRevision.set(1); fixture.detectChanges();
    expect(router.navigateByUrl).toHaveBeenCalledExactlyOnceWith('/');
    auth.userId.set(null); auth.sessionRevision.set(2); fixture.detectChanges();
    expect(router.navigateByUrl).toHaveBeenCalledTimes(2);
  });
  it('does not redirect a public sample during initial sign-in but detects a switch-back', () => {
    const { auth, router, fixture } = setup(null);
    auth.userId.set('owner-a'); auth.sessionRevision.set(1); fixture.detectChanges();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    auth.sessionRevision.set(3); fixture.detectChanges();
    expect(router.navigateByUrl).toHaveBeenCalledExactlyOnceWith('/');
  });
});

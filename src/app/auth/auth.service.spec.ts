import { TestBed } from '@angular/core/testing';
import type { Clerk } from '@clerk/clerk-js';
import { describe, expect, it, vi } from 'vitest';
import { ConfigService } from '../core/config.service';
import { AuthService } from './auth.service';

describe('provider token ownership', () => {
  it('rejects a provider account change before its listener updates the UI', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: ConfigService, useValue: {} }] });
    const auth = TestBed.inject(AuthService); auth.userId.set('owner-a');
    let finish!: (value: string) => void;
    const session = { id: 'session-a', getToken: vi.fn(() => new Promise<string>(resolve => { finish = resolve; })) };
    const clerk = { user: { id: 'owner-a' }, session };
    vi.spyOn(auth, 'init').mockResolvedValue(clerk as unknown as Clerk);
    const result = auth.token().catch(error => error);
    await Promise.resolve();
    clerk.user.id = 'owner-b'; finish('token-a');
    expect(await result).toBeInstanceOf(Error);
  });
  it('never asks the next provider session for a token using the previous UI owner', async () => {
    TestBed.configureTestingModule({ providers: [{ provide: ConfigService, useValue: {} }] });
    const auth = TestBed.inject(AuthService); auth.userId.set('owner-a');
    const session = { id: 'session-b', getToken: vi.fn() };
    vi.spyOn(auth, 'init').mockResolvedValue({ user: { id: 'owner-b' }, session } as unknown as Clerk);
    expect(await auth.token()).toBeNull(); expect(session.getToken).not.toHaveBeenCalled();
  });
});

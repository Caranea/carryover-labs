import { inject, Injectable, signal } from '@angular/core';
import type { Clerk } from '@clerk/clerk-js';
import { ConfigService } from '../core/config.service';

/** Clerk's sign-in box and user menu, styled to match the daisyUI theme. */
const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#0d7a68',
    colorText: '#16302c',
    colorTextSecondary: '#4f6662',
    colorBackground: '#ffffff',
    colorInputBackground: '#ffffff',
    colorInputText: '#16302c',
    colorDanger: '#d4372c',
    colorSuccess: '#17a058',
    fontFamily: "'Figtree Variable', system-ui, sans-serif",
    fontSize: '0.95rem',
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', borderRadius: '1.25rem', boxShadow: '0 10px 30px -12px rgba(22, 48, 44, 0.25)' },
    headerTitle: { fontFamily: "'Outfit Variable', system-ui, sans-serif", fontWeight: 600 },
    formButtonPrimary: { borderRadius: '999px', fontWeight: 600, boxShadow: 'none' },
    socialButtonsBlockButton: { borderRadius: '999px' },
  },
};

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in' | 'error';

/**
 * Clerk sign-in. Clerk only ever sees account details (e-mail, password or
 * social login), never documents.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly config = inject(ConfigService);

  readonly status = signal<AuthStatus>('loading');
  readonly error = signal<string | null>(null);
  readonly userId = signal<string | null>(null);
  /** Changes synchronously even if A→B→A occurs before a component effect runs. */
  readonly sessionRevision = signal(0);

  private clerk: Promise<Clerk> | null = null;

  /** Load Clerk once. Resolves when the session state is known. */
  init(): Promise<Clerk> {
    this.clerk ??= (async () => {
      try {
        const [{ clerkPublishableKey }, { Clerk }, { loadClerkUIScript }] = await Promise.all([
          this.config.get(),
          import('@clerk/clerk-js'),
          import('@clerk/shared/loadClerkJsScript'),
        ]);
        if (!clerkPublishableKey) throw new Error('CLERK_PUBLISHABLE_KEY is not set in api/.env.');
        // The npm build of clerk-js has no UI; the sign-in components come from Clerk's CDN
        // (only account screens use them, never documents).
        await loadClerkUIScript({ publishableKey: clerkPublishableKey });
        const ClerkUI = (window as unknown as { __internal_ClerkUICtor?: unknown }).__internal_ClerkUICtor;
        if (!ClerkUI) throw new Error('The Clerk sign-in screen could not be loaded.');
        const clerk = new Clerk(clerkPublishableKey);
        await clerk.load({
          ui: { ClerkUI: ClerkUI as never },
          signInFallbackRedirectUrl: '/',
          signUpFallbackRedirectUrl: '/',
          afterSignOutUrl: '/sign-in',
          appearance: CLERK_APPEARANCE,
        });
        const sync = () => {
          const owner = clerk.isSignedIn ? clerk.user?.id ?? null : null;
          if (owner !== this.userId()) this.sessionRevision.update((revision) => revision + 1);
          this.userId.set(owner);
          this.status.set(clerk.isSignedIn ? 'signed-in' : 'signed-out');
        };
        sync();
        clerk.addListener(sync);
        return clerk;
      } catch (e) {
        this.clerk = null;
        this.sessionRevision.update((revision) => revision + 1);
        this.userId.set(null);
        this.status.set('error');
        this.error.set(e instanceof Error ? e.message : String(e));
        throw e;
      }
    })();
    return this.clerk;
  }

  async isSignedIn(): Promise<boolean> {
    try {
      return (await this.init()).isSignedIn;
    } catch {
      return false;
    }
  }

  async token(): Promise<string | null> {
    const owner = this.userId(), revision = this.sessionRevision();
    const clerk = await this.init();
    const session = clerk.session;
    if (!owner || !session || clerk.user?.id !== owner) return null;
    const token = await session.getToken();
    // Also inspect Clerk directly: its listener may not yet have updated our signals.
    if (clerk.user?.id !== owner || clerk.session?.id !== session.id || this.userId() !== owner || this.sessionRevision() !== revision) {
      throw new Error('Your signed-in account changed. Open the page again to continue.');
    }
    return token;
  }

  async mountSignIn(el: HTMLDivElement) {
    (await this.init()).mountSignIn(el, {
      routing: 'hash',
      withSignUp: true,
      fallbackRedirectUrl: '/',
      signUpFallbackRedirectUrl: '/',
    });
  }

  async unmountSignIn(el: HTMLDivElement) {
    (await this.clerk)?.unmountSignIn(el);
  }

  async mountUserButton(el: HTMLDivElement) {
    (await this.init()).mountUserButton(el);
  }

  async unmountUserButton(el: HTMLDivElement) {
    (await this.clerk)?.unmountUserButton(el);
  }

  async signOut() {
    await (await this.init()).signOut();
  }
}

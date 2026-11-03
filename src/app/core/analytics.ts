import { inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CanActivateFn, NavigationEnd, Router } from '@angular/router';
import { DocumentQueueService } from './document-queue.service';

export const ANALYTICS_ID = 'G-BXBQG207SK';
export const ANALYTICS_CONSENT_KEY = 'carryover.analytics-consent';
/** Google's documented switch: while true, gtag.js sends nothing for this property. */
const DISABLE_FLAG = `ga-disable-${ANALYTICS_ID}`;
/** The only pages Google's script may run on: neither shows a person's own documents. */
const TRACKED_PAGES = ['/', '/demo'];

type Consent = 'accepted' | 'declined';
interface GoogleTagWindow {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

function readConsent(): Consent | null {
  try {
    const saved = localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return saved === 'accepted' || saved === 'declined' ? saved : null;
  } catch {
    return null; // Storage blocked: ask again on the next visit.
  }
}

function saveConsent(consent: Consent) {
  try {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, consent);
  } catch {
    /* Storage blocked: the choice still holds until the page closes. */
  }
}

/** The page as Google sees it: no query or hash, and no document ids from the address. */
export function analyticsPath(url: string): string {
  return url.split(/[?#]/)[0].replace(/^\/(review|saved)\/.*$/, '/$1');
}

export function isTrackedPage(url: string): boolean {
  return TRACKED_PAGES.includes(analyticsPath(url));
}

/** Remove Google Analytics' cookies, on this host and on any parent domain it may have used. */
export function clearAnalyticsCookies() {
  const names = document.cookie
    .split(';')
    .map((cookie) => cookie.split('=')[0].trim())
    .filter((name) => name === '_ga' || name.startsWith('_ga_'));
  const parts = location.hostname.split('.');
  const domains = ['', ...parts.map((_, i) => `; domain=.${parts.slice(i).join('.')}`)];
  for (const name of names) {
    for (const domain of domains) document.cookie = `${name}=; path=/; max-age=0${domain}`;
  }
}

/**
 * Pages with a person's documents or results. A loaded script can't be unloaded, so arriving here
 * with it in memory opens the page fresh instead of through the router.
 */
export const withoutAnalyticsGuard: CanActivateFn = (_route, state) => {
  if (!inject(AnalyticsService).loaded) return true;
  location.assign(state.url);
  return false;
};

/**
 * Google Analytics, loaded only after someone accepts it and only on the tracked pages. It also
 * waits for an empty queue: the review dialog can open on any page, showing unredacted documents.
 * Documents join the queue only on pages that open fresh, so a loaded script never meets one.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly queue = inject(DocumentQueueService);
  readonly consent = signal(readConsent());
  /** The banner is showing: no choice yet, or the choice was reopened from the footer. */
  readonly choosing = signal(this.consent() === null);
  private url: string | null = null;
  private started = false;

  get loaded() {
    return this.started;
  }

  constructor() {
    inject(Router)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        if (!(event instanceof NavigationEnd)) return;
        this.url = event.urlAfterRedirects;
        if (this.consent() === 'accepted') void this.track();
      });
  }

  accept() {
    this.choose('accepted');
    void this.track();
  }

  decline() {
    this.choose('declined');
    if (this.started) (window as unknown as Record<string, unknown>)[DISABLE_FLAG] = true;
    clearAnalyticsCookies();
  }

  reopen() {
    this.choosing.set(true);
  }

  private choose(consent: Consent) {
    this.consent.set(consent);
    this.choosing.set(false);
    saveConsent(consent);
  }

  private async track() {
    const url = this.url;
    if (url === null || !isTrackedPage(url)) return; // Navigation calls this again.
    await this.queue.ready;
    // By now the router has set the title too, which it does just after NavigationEnd.
    if (this.queue.batchProgress().total || this.consent() !== 'accepted') return;
    this.start();
    const page = `${location.origin}${analyticsPath(url)}`;
    const { gtag } = window as unknown as GoogleTagWindow;
    gtag?.('set', { page_location: page });
    gtag?.('event', 'page_view', { page_location: page, page_title: document.title });
  }

  private start() {
    (window as unknown as Record<string, unknown>)[DISABLE_FLAG] = false;
    if (this.started) return;
    this.started = true;
    const page = window as unknown as GoogleTagWindow;
    page.dataLayer ??= [];
    // gtag.js only reads the arguments object itself, not an array of the same values.
    page.gtag = function () {
      // eslint-disable-next-line prefer-rest-params
      page.dataLayer?.push(arguments);
    };
    page.gtag('js', new Date());
    page.gtag('config', ANALYTICS_ID, {
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${ANALYTICS_ID}`;
    document.head.appendChild(script);
  }
}

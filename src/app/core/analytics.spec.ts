import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ANALYTICS_CONSENT_KEY,
  ANALYTICS_ID,
  AnalyticsService,
  analyticsPath,
  clearAnalyticsCookies,
} from './analytics';

@Component({ template: '' })
class Blank {}

const page = window as unknown as { dataLayer?: ArrayLike<unknown>[]; gtag?: unknown };
const tagScripts = () => document.querySelectorAll('script[src*="googletagmanager"]');
const pageViews = () =>
  (page.dataLayer ?? [])
    .map((entry) => Array.from(entry))
    .filter((entry) => entry[1] === 'page_view');

function setUp() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: '', component: Blank },
        { path: 'review/:id', component: Blank },
      ]),
    ],
  });
  return { analytics: TestBed.inject(AnalyticsService), router: TestBed.inject(Router) };
}

describe('analytics consent', () => {
  beforeEach(() => localStorage.removeItem(ANALYTICS_CONSENT_KEY));
  afterEach(() => {
    tagScripts().forEach((script) => script.remove());
    delete page.dataLayer;
    delete page.gtag;
  });

  it('loads nothing and asks when no choice has been made', async () => {
    const { analytics, router } = setUp();
    await router.navigateByUrl('/review/abc');
    expect(analytics.choosing()).toBe(true);
    expect(tagScripts().length).toBe(0);
    expect(page.dataLayer).toBeUndefined();
  });

  it('loads Google tag only after accepting, without document ids in the address', async () => {
    const { analytics, router } = setUp();
    await router.navigateByUrl('/?x=1');
    analytics.accept();
    await Promise.resolve();
    expect(tagScripts().length).toBe(1);
    expect(analytics.choosing()).toBe(false);
    expect(localStorage.getItem(ANALYTICS_CONSENT_KEY)).toBe('accepted');
    expect(pageViews()).toEqual([
      ['event', 'page_view', expect.objectContaining({ page_location: `${location.origin}/` })],
    ]);
  });

  it('keeps tracking on later visits once accepted', async () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'accepted');
    const { analytics, router } = setUp();
    expect(analytics.choosing()).toBe(false);
    await router.navigateByUrl('/');
    await Promise.resolve();
    expect(tagScripts().length).toBe(1);
    expect(pageViews().length).toBe(1);
  });

  it('stays off after declining', async () => {
    localStorage.setItem(ANALYTICS_CONSENT_KEY, 'declined');
    const { analytics, router } = setUp();
    await router.navigateByUrl('/');
    expect(analytics.choosing()).toBe(false);
    expect(tagScripts().length).toBe(0);
  });

  it('stops sending and removes cookies when consent is withdrawn', async () => {
    const { analytics, router } = setUp();
    await router.navigateByUrl('/');
    analytics.accept();
    await Promise.resolve();
    document.cookie = '_ga=GA1.1.1; path=/';
    analytics.reopen();
    expect(analytics.choosing()).toBe(true);
    analytics.decline();
    await router.navigateByUrl('/review/abc');
    await Promise.resolve();
    expect((window as unknown as Record<string, unknown>)[`ga-disable-${ANALYTICS_ID}`]).toBe(true);
    expect(document.cookie).not.toContain('_ga=');
    expect(pageViews().length).toBe(1);
  });
});

describe('analytics helpers', () => {
  it('reduces addresses to the page', () => {
    expect(analyticsPath('/')).toBe('/');
    expect(analyticsPath('/documents?from=home#top')).toBe('/documents');
    expect(analyticsPath('/review/local-1')).toBe('/review');
    expect(analyticsPath('/saved/server-1')).toBe('/saved');
  });

  it('leaves other cookies alone', () => {
    document.cookie = 'other=1; path=/';
    document.cookie = `_ga_${ANALYTICS_ID.slice(2)}=x; path=/`;
    clearAnalyticsCookies();
    expect(document.cookie).toContain('other=1');
    expect(document.cookie).not.toContain('_ga_');
    document.cookie = 'other=; path=/; max-age=0';
  });
});

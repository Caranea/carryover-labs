import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { DEMO_RECORDS, DEMO_RESULTS } from '../core/demo-data';
import { DocumentsApi } from '../core/documents-api';
import { ResultsPage } from './results.page';

describe('results account boundaries', () => {
  it('discards delayed records and clears raw readings when the user signs out', async () => {
    let resolve!: (value: unknown) => void;
    const api = { results: vi.fn().mockResolvedValue(DEMO_RESULTS), records: vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })) };
    const auth = { userId: signal<string | null>('account-a'), sessionRevision: signal(0) };
    TestBed.configureTestingModule({ imports: [ResultsPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } }, { provide: DocumentsApi, useValue: api }, { provide: AuthService, useValue: auth }] });
    const fixture = TestBed.createComponent(ResultsPage); fixture.detectChanges();
    await vi.waitFor(() => expect(api.records).toHaveBeenCalledOnce());
    const component = fixture.componentInstance as any;
    expect(component.raw()).not.toBeNull();
    auth.userId.set(null); auth.sessionRevision.update((n) => n + 1); fixture.detectChanges();
    resolve(DEMO_RECORDS); await fixture.whenStable(); fixture.detectChanges();
    expect(component.data()).toBeNull(); expect(component.raw()).toBeNull(); expect(component.error()).toBeNull();
    expect(component.refreshing()).toBe(false);
  });

  it('does not continue a delayed raw-results request after A to B to A before an effect runs', async () => {
    let resolve!: (value: unknown) => void;
    const empty = { ...DEMO_RESULTS, documents: [], observations: [] };
    const api = { results: vi.fn().mockReturnValueOnce(new Promise((done) => { resolve = done; })).mockResolvedValue(empty), records: vi.fn().mockResolvedValue({ ...DEMO_RECORDS, domains: [], warnings: [], textResults: [] }) };
    const auth = { userId: signal<string | null>('account-a'), sessionRevision: signal(0) };
    TestBed.configureTestingModule({ imports: [ResultsPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } }, { provide: DocumentsApi, useValue: api }, { provide: AuthService, useValue: auth }] });
    const fixture = TestBed.createComponent(ResultsPage); fixture.detectChanges();
    auth.userId.set('account-b'); auth.sessionRevision.update((n) => n + 1);
    auth.userId.set('account-a'); auth.sessionRevision.update((n) => n + 1);
    resolve(DEMO_RESULTS); await Promise.resolve(); fixture.detectChanges(); await fixture.whenStable();
    const component = fixture.componentInstance as any;
    expect(component.raw().observations).toEqual([]); expect(api.records).toHaveBeenCalledOnce();
  });
});

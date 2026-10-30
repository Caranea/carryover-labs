import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { DEMO_RECORDS, DEMO_RESULTS } from '../core/demo-data';
import { DocumentsApi } from '../core/documents-api';
import { ResultsPage } from './results.page';

describe('results view lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows processing, then an error with retry, and only displays results after server success', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    let reject!: (error: Error) => void;
    const api = {
      results: vi.fn().mockResolvedValue(DEMO_RESULTS),
      records: vi.fn().mockReturnValue(new Promise((_resolve, fail) => { reject = fail; })),
      retryRecords: vi.fn().mockResolvedValue(DEMO_RECORDS),
    };
    TestBed.configureTestingModule({ imports: [ResultsPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } }, { provide: DocumentsApi, useValue: api }] });
    const fixture = TestBed.createComponent(ResultsPage); fixture.detectChanges();
    const component = fixture.componentInstance as any;
    expect(fixture.nativeElement.textContent).toContain('Processing your approved lab data');
    expect(fixture.nativeElement.querySelector('.stats')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/appointment"]')).toBeNull();
    reject(new Error('Results processing did not finish. Please try again.'));
    await vi.waitFor(() => expect(component.error()).toContain('Please try again'));
    fixture.detectChanges();
    expect(component.data()).toBeNull();
    expect(fixture.nativeElement.querySelector('.stats')).toBeNull();
    const retry = [...fixture.nativeElement.querySelectorAll('button')].find((button: any) => button.textContent.trim() === 'Try again') as HTMLButtonElement;
    retry.click();
    await vi.waitFor(() => expect(component.data()).toBe(DEMO_RECORDS));
    fixture.detectChanges();
    expect(api.retryRecords).toHaveBeenCalledOnce();
    expect(component.error()).toBeNull();
    expect(fixture.nativeElement.querySelector('.stats')).not.toBeNull();
    fixture.destroy();
  });

  it('discards delayed results after leaving the page', async () => {
    let resolve!: (value: unknown) => void;
    const api = { results: vi.fn().mockResolvedValue(DEMO_RESULTS), records: vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })) };
    TestBed.configureTestingModule({ imports: [ResultsPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } }, { provide: DocumentsApi, useValue: api }] });
    const fixture = TestBed.createComponent(ResultsPage); fixture.detectChanges();
    await vi.waitFor(() => expect(api.records).toHaveBeenCalledOnce());
    const component = fixture.componentInstance as any;
    fixture.destroy();
    resolve(DEMO_RECORDS); await Promise.resolve(); await Promise.resolve();
    expect(component.data()).toBeNull();
  });
});

import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { DEMO_RECORDS, DEMO_RESULTS } from '../core/demo-data';
import { DocumentsApi } from '../core/documents-api';
import { ResultsPage } from './results.page';

describe('results view lifecycle', () => {
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

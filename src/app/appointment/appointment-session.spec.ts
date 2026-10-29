import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service';
import { DEMO_RECORDS, DEMO_RESULTS } from '../core/demo-data';
import { DocumentsApi } from '../core/documents-api';
import { AppointmentPage } from './appointment.page';
class FakeWorker {
  static latest: FakeWorker | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.latest = this; }
}

describe('appointment account boundaries', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); FakeWorker.latest = undefined; });
  function setup(api: Partial<DocumentsApi>) {
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
    const auth = { userId: signal<string | null>('account-a'), sessionRevision: signal(0) };
    TestBed.configureTestingModule({ imports: [AppointmentPage], providers: [provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } }, { provide: DocumentsApi, useValue: api }, { provide: AuthService, useValue: auth }] });
    const fixture = TestBed.createComponent(AppointmentPage); fixture.detectChanges();
    return { fixture, auth, component: fixture.componentInstance as any };
  }
  it('never restores old appointment records after sign-out', async () => {
    let resolve!: (value: unknown) => void;
    const { fixture, auth, component } = setup({ records: vi.fn().mockReturnValue(new Promise((done) => { resolve = done; })), results: vi.fn().mockResolvedValue(DEMO_RESULTS) });
    component.notes = 'Private appointment question';
    auth.userId.set(null); auth.sessionRevision.update((n) => n + 1); fixture.detectChanges();
    resolve(DEMO_RECORDS); await fixture.whenStable(); fixture.detectChanges();
    expect(component.data()).toBeNull(); expect(component.raw()).toBeNull(); expect(component.notes).toBe(''); expect(component.sources()).toEqual([]);
  });
  it('aborts export and never downloads a completed PDF from a previous session', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { fixture, auth, component } = setup({ records: vi.fn().mockResolvedValue(DEMO_RECORDS), results: vi.fn().mockResolvedValue(DEMO_RESULTS) });
    await vi.waitFor(() => expect(component.data()).not.toBeNull()); fixture.detectChanges();
    component.notes = 'Private appointment question';
    const exporting = component.downloadPdf();
    await vi.waitFor(() => {
      expect(component.exportError()).toBeNull();
      expect(FakeWorker.latest?.postMessage).toHaveBeenCalledOnce();
    });
    const worker = FakeWorker.latest!;
    auth.userId.set('account-b'); auth.sessionRevision.update((n) => n + 1);
    auth.userId.set('account-a'); auth.sessionRevision.update((n) => n + 1);
    fixture.detectChanges();
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onmessage?.({ data: { pdf: new ArrayBuffer(4) } } as MessageEvent);
    await exporting; await fixture.whenStable();
    expect(click).not.toHaveBeenCalled(); expect(component.notes).toBe(''); expect(component.exported()).toBe(false); expect(component.exportError()).toBeNull();
  });
  it('refuses printing in the gap before account-change effects clear the old DOM', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const { fixture, auth, component } = setup({ records: vi.fn().mockResolvedValue(DEMO_RECORDS), results: vi.fn().mockResolvedValue(DEMO_RESULTS) });
    await vi.waitFor(() => expect(component.data()).not.toBeNull()); fixture.detectChanges();
    auth.userId.set('account-b'); auth.sessionRevision.update((n) => n + 1);
    component.print();
    expect(print).not.toHaveBeenCalled();
  });
});

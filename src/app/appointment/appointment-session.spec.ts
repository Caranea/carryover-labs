import { settled } from '../../testing/settled';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { DEMO_RECORDS, DEMO_RESULTS } from '../core/demo-data';
import { LocalHistory } from '../core/local-history';
import { ResultsService } from '../core/results.service';
import { AppointmentPage } from './appointment.page';
class FakeWorker {
  static latest: FakeWorker | undefined;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}

describe('appointment view lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    FakeWorker.latest = undefined;
  });
  function setup(api: Partial<ResultsService & LocalHistory>) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    TestBed.configureTestingModule({
      imports: [AppointmentPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: { get: () => null } } } },
        { provide: ResultsService, useValue: api },
        { provide: LocalHistory, useValue: api },
      ],
    });
    const fixture = TestBed.createComponent(AppointmentPage);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance as any };
  }
  it('keeps appointment export unavailable when server processing fails', async () => {
    const { fixture, component } = setup({
      records: vi.fn().mockRejectedValue(new Error('Please try again.')),
      results: vi.fn().mockResolvedValue(DEMO_RESULTS),
    });
    await settled(() => expect(component.error()).toBe('Please try again.'));
    fixture.detectChanges();
    expect(component.data()).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Download appointment PDF');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    fixture.destroy();
  });
  it('aborts export when the appointment view is destroyed', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { fixture, component } = setup({
      records: vi.fn().mockResolvedValue(DEMO_RECORDS),
      results: vi.fn().mockResolvedValue(DEMO_RESULTS),
    });
    await settled(() => expect(component.data()).not.toBeNull());
    fixture.detectChanges();
    component.notes = 'Private appointment question';
    const exporting = component.downloadPdf();
    await settled(() => {
      expect(component.exportError()).toBeNull();
      expect(FakeWorker.latest?.postMessage).toHaveBeenCalledOnce();
    });
    const worker = FakeWorker.latest!;
    fixture.destroy();
    expect(worker.terminate).toHaveBeenCalledOnce();
    worker.onmessage?.({ data: { pdf: new ArrayBuffer(4) } } as MessageEvent);
    await exporting;
    expect(click).not.toHaveBeenCalled();
    expect(component.exported()).toBe(false);
    expect(component.exportError()).toBeNull();
  });
});

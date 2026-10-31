import { vi } from 'vitest';
import { DEMO_RECORDS } from '../core/demo-data';
import { PDF_LIMITS } from './appointment-pdf';
import { generateAppointmentPdf } from './pdf-download';

class FakeWorker {
  static latest: FakeWorker;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    FakeWorker.latest = this;
  }
}
const input = {
  records: DEMO_RECORDS,
  questions: '',
  preparedAt: '2026-10-29T00:00:00Z',
  fictional: true,
};

describe('bounded PDF generation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  it('terminates the worker when the patient leaves the page', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const abort = new AbortController();
    const result = generateAppointmentPdf(input, abort.signal);
    abort.abort();
    await expect(result).rejects.toThrow('cancelled');
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
  it('stops a slow worker without producing a partial download', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const result = generateAppointmentPdf(input);
    const rejected = expect(result).rejects.toThrow('No partial PDF was saved');
    await vi.advanceTimersByTimeAsync(PDF_LIMITS.milliseconds);
    await rejected;
    expect(FakeWorker.latest.terminate).toHaveBeenCalledOnce();
  });
});

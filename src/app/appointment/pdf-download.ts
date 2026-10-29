import { AppointmentPdfInput, PDF_LIMITS, validatePdfInput } from './appointment-pdf';

export function generateAppointmentPdf(input: AppointmentPdfInput, signal?: AbortSignal): Promise<Blob> {
  validatePdfInput(input);
  if (signal?.aborted) return Promise.reject(new Error('PDF export cancelled.'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./appointment-pdf.worker', import.meta.url), { type: 'module' });
    const finish = () => { clearTimeout(timer); worker.terminate(); signal?.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new Error('PDF export cancelled.')); };
    const timer = setTimeout(() => { finish(); reject(new Error('PDF generation took too long on this device. Choose fewer groups and try again. No partial PDF was saved.')); }, PDF_LIMITS.milliseconds);
    worker.onmessage = ({ data }: MessageEvent<{ pdf?: ArrayBuffer; error?: string }>) => {
      finish();
      if (data.pdf) resolve(new Blob([data.pdf], { type: 'application/pdf' }));
      else reject(new Error(data.error || 'Could not make the PDF. Try again.'));
    };
    worker.onerror = () => { finish(); reject(new Error('This device could not start PDF generation. Reload and try again, or choose fewer groups.')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage(input);
  });
}


/// <reference lib="webworker" />
import { AppointmentPdfInput } from './appointment-pdf';
import { createAppointmentPdf } from './pdf-engine';

addEventListener('message', async ({ data }: MessageEvent<AppointmentPdfInput>) => {
  try {
    const pdf = await createAppointmentPdf(data);
    postMessage({ pdf: pdf.buffer }, [pdf.buffer]);
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : 'Could not make the PDF. Try fewer groups.' });
  }
});


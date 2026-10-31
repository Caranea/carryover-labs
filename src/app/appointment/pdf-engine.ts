import { AppointmentPdfInput, appointmentPdfDefinition, PDF_LIMITS } from './appointment-pdf';

/** Called in a worker in the app, and directly by artifact tests. No remote fonts or images. */
export async function createAppointmentPdf(input: AppointmentPdfInput): Promise<Uint8Array> {
  const definition = appointmentPdfDefinition(input);
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake.js'),
    import('pdfmake/build/vfs_fonts.js'),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  pdfMake.setUrlAccessPolicy(() => false);
  const buffer = await pdfMake.createPdf(definition).getBuffer();
  if (buffer.byteLength > PDF_LIMITS.bytes)
    throw new Error(
      'This PDF is too large for a phone download. Choose fewer groups. No partial PDF was saved.',
    );
  return new Uint8Array(buffer);
}

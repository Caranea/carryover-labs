/** Builds only a fully fabricated fixture for PDF render QA. Run via the documented esbuild command. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEMO_RECORDS } from '../src/app/core/demo-data';
import { createAppointmentPdf } from '../src/app/appointment/pdf-engine';

async function main() {
  const output = resolve(process.argv[2] ?? 'output/pdf/carryover-fictional-appointment.pdf');
  const records = structuredClone(DEMO_RECORDS);
  const pdf = await createAppointmentPdf({ records, questions: 'Płytki krwi i żółć: pytania do lekarza.\nÜberprüfung der Werte: Grüße und Fragen.\nWhich original records should I bring?', preparedAt: '2026-10-29T10:00:00.000Z', fictional: true });
  await mkdir(resolve(output, '..'), { recursive: true });
  await writeFile(output, pdf);
  process.stdout.write(`${output}\n${pdf.byteLength} bytes\n`);
}
void main().catch((error) => { process.stderr.write(String(error)); process.exitCode = 1; });


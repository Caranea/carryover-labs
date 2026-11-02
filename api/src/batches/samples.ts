import { existsSync, readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import type { JsonModel, ModelTask } from '../records/meta-model.js';
import type { PageDate, PrintedRow } from '../shared/processing.js';
import type { IdentityCache, RecordedIdentity } from './normalization.js';

/** A sample page: the demo document's id and the page index, as in "jane-doe-039:0". */
export const SAMPLE_KEY = /^[a-z0-9-]{1,60}:\d{1,2}$/;

/** Muse Spark's answer for one page, exactly as the model returned it. */
export interface RecordedPage {
  rows: PrintedRow[];
  dates: PageDate[];
  suggestedName: string | null;
}

/**
 * Real Meta answers for the sample patient, recorded once by scripts/record-samples.mjs and
 * committed: Muse Spark's transcription of every sample page, and Muse Wonder's identity of
 * every printed test name on them. Replaying them costs nothing and needs no key.
 */
export interface SampleRecording {
  recordedAt: string;
  note?: string;
  models: { transcription: string; identification: string };
  pages: Record<string, RecordedPage>;
  /** Keyed by question (printed name, percentage, fluid), as normalization asks them. */
  identities: Record<string, RecordedIdentity>;
  /** English for each printed specimen, keyed by the folded printed text. */
  specimens: Record<string, string>;
}

export class SampleAnswers implements IdentityCache {
  private static readonly log = new Logger('Samples');

  constructor(private readonly recording: SampleRecording | null) {}

  /** The committed recording, or none (the sample patient is then switched off). */
  static load(file: string): SampleAnswers {
    if (!existsSync(file)) {
      SampleAnswers.log.warn(`No recorded sample answers at ${file}: the sample patient is off.`);
      return new SampleAnswers(null);
    }
    const recording = JSON.parse(readFileSync(file, 'utf8')) as SampleRecording;
    SampleAnswers.log.log(
      `Sample patient: ${Object.keys(recording.pages).length} recorded pages, ` +
        `${Object.keys(recording.identities).length} test names`,
    );
    return new SampleAnswers(recording);
  }

  get available(): boolean {
    return !!this.recording && Object.keys(this.recording.pages).length > 0;
  }

  has(sample: string): boolean {
    return !!this.recording?.pages[sample];
  }

  /** A model that answers with the recorded transcription of this sample page, and nothing else. */
  page(sample: string): JsonModel {
    const answer = this.recording?.pages[sample];
    return {
      name: 'Recorded Muse Spark answer',
      ask: async <T>(task: ModelTask) => {
        if (!answer || task.kind !== 'transcribe-page') throw new Error('Not recorded');
        return structuredClone(answer) as T;
      },
    };
  }

  identity(question: string): RecordedIdentity | undefined {
    return this.recording?.identities[question];
  }

  specimen(printed: string): string | undefined {
    return this.recording?.specimens[printed];
  }
}

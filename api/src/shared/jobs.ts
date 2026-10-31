import type { PageTranscription } from './processing.js';

/** Contract of the batch job endpoints, shared by the API and the browser. */
export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface PageJobView {
  pageId: string;
  revision: string;
  state: JobState;
  result?: PageTranscription;
  error?: string;
}

export interface NormalizationView<R> {
  state: JobState | 'idle';
  result?: R;
  error?: string;
}

export interface BatchView<R> {
  /** Increases on every change; pass it back as `since` to wait for the next one. */
  version: number;
  pages: PageJobView[];
  normalization: NormalizationView<R>;
}

/** A long poll answers within this many seconds even when nothing changed. */
export const MAX_WAIT_SECONDS = 25;

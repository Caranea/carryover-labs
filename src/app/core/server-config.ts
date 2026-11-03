import { computed, Injectable, signal } from '@angular/core';
import { DEMO_DOCUMENTS } from './demo-documents';

export interface ServerConfig {
  models: { transcription: string; identification: string };
  /** New documents can be read: the server has a Meta key. */
  live: boolean;
  /** Sample patient pages ("jane-doe-039:0") whose recorded Meta answers are on the server. */
  samplePages: string[];
}

/** What the API can read, fetched once per visit. Null while unknown or unreachable. */
@Injectable({ providedIn: 'root' })
export class ServerConfigService {
  readonly config = signal<ServerConfig | null>(null);
  /** Sample documents with every page recorded: the only ones offered. */
  readonly sampleDocuments = computed(() => {
    const recorded = new Set(this.config()?.samplePages ?? []);
    return DEMO_DOCUMENTS.filter((doc) =>
      doc.pages.every((_, index) => recorded.has(`${doc.id}:${index}`)),
    );
  });
  /** The request finished, whether or not the API answered. */
  readonly loaded = signal(false);
  private request?: Promise<ServerConfig | null>;

  load(): Promise<ServerConfig | null> {
    this.request ??= fetch('/api/config')
      .then(async (response) => (response.ok ? ((await response.json()) as ServerConfig) : null))
      .catch(() => null)
      .then((config) => {
        this.config.set(config);
        this.loaded.set(true);
        return config;
      });
    return this.request;
  }
}

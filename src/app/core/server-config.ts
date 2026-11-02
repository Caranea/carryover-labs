import { Injectable, signal } from '@angular/core';

export interface ServerConfig {
  models: { transcription: string; identification: string };
  /** New documents can be read: the server has a Meta key. */
  live: boolean;
  /** The sample patient's recorded Meta answers are on the server. */
  samplePatient: boolean;
}

/** What the API can read, fetched once per visit. Null while unknown or unreachable. */
@Injectable({ providedIn: 'root' })
export class ServerConfigService {
  readonly config = signal<ServerConfig | null>(null);
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

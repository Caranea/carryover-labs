import { Injectable } from '@angular/core';

export interface PublicConfig {
  clerkPublishableKey: string;
  storageProtection?: 'encrypted-new-files' | 'development-plaintext';
}

/** Public settings served by the API, so keys live in one .env file. */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private config: Promise<PublicConfig> | null = null;

  get(): Promise<PublicConfig> {
    this.config ??= fetch('/api/config')
      .then((r) => {
        if (!r.ok) throw new Error(`The server is not reachable (${r.status}).`);
        return r.json() as Promise<PublicConfig>;
      })
      .catch((e) => {
        this.config = null;
        throw e;
      });
    return this.config;
  }
}


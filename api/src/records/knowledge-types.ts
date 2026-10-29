import type { CatalogueTest } from './catalogue.js';

/** Learned suggestions belong to one account, never the global catalogue. */
export interface Knowledge {
  version: 1;
  names: Record<string, { key: string | null; reason?: string }>;
  tests: CatalogueTest[];
  conversions: Record<string, { factor: number; note: string }>;
}


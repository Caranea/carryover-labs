import { defineConfig } from 'vitest/config';

// Angular's test builder shares globals between spec files by default. These specs use
// localStorage, IndexedDB and stubbed globals, so each file gets its own environment.
export default defineConfig({
  test: { isolate: true },
});

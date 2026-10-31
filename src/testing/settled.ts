import { vi } from 'vitest';

/**
 * Wait for asynchronous state to settle. The generous timeout keeps tests stable on a cold or
 * busy machine; a passing assertion still returns as soon as it holds.
 */
export function settled<T>(assertion: () => T | Promise<T>): Promise<T> {
  return vi.waitFor(assertion, { timeout: 4_000, interval: 20 });
}

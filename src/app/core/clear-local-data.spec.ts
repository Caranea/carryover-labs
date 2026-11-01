import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CLEARED_FLAG, clearLocalData } from './clear-local-data';
import { deviceTransaction } from './device-storage';

describe('clearing all local data', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('deletes the device database and every Carryover key, and tells the server to forget the batch', async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    localStorage.setItem('carryover.processing.batch', 'batch-1');
    localStorage.setItem('carryover.demo.history.v1', '{"entries":[]}');
    localStorage.setItem('someone-else', 'kept');
    await deviceTransaction<void>(['queue-state'], 'readwrite', (tx) => {
      tx.objectStore('queue-state').put({ fileName: 'Jane_Doe.pdf' }, 'head');
    });

    await clearLocalData();

    expect(fetch).toHaveBeenCalledWith(
      '/api/demo/batches/batch-1',
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(Object.keys(localStorage).filter((k) => k.startsWith('carryover.'))).toEqual([]);
    expect(localStorage.getItem('someone-else')).toBe('kept');
    expect(sessionStorage.getItem(CLEARED_FLAG)).toBe('1');
    expect((await indexedDB.databases()).map((d) => d.name)).not.toContain('carryover.device.v1');
    // Nothing in this tab can write the old state back before the reload.
    await expect(deviceTransaction(['queue-state'], 'readonly', () => {})).rejects.toThrow();
  });
});

/** Binary files stay in IndexedDB, never in localStorage or a network request. */
const DATABASE = 'carryover.device.v1';
let connection: Promise<IDBDatabase> | undefined;
/** Set while everything is being deleted, so nothing in this tab can write it back. */
let wiping = false;

export function deviceDatabase(): Promise<IDBDatabase> {
  if (wiping) return Promise.reject(new Error('Local data is being deleted.'));
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Local file storage is unavailable in this browser.'));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timeout = setTimeout(() => {
      expired = true;
      reject(new Error('Local storage is busy in another tab. Close that tab and retry.'));
    }, 8000);
    request.onupgradeneeded = () => {
      for (const name of ['queue-state', 'queue-documents', 'approved-images']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onerror = () => {
      clearTimeout(timeout);
      reject(request.error);
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      if (expired) {
        db.close();
        return;
      }
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      db.onclose = () => {
        connection = undefined;
      };
      resolve(db);
    };
  }).catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

export async function deviceTransaction<T>(
  stores: string[],
  mode: IDBTransactionMode,
  schedule: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  const db = await deviceDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () =>
      reject(failure ?? tx.error ?? new Error('Local saving was interrupted. Please retry.'));
    tx.onerror = () => {
      /* The abort event reports the failure once. */
    };
    try {
      schedule(
        tx,
        (result) => {
          value = result;
        },
        (error) => {
          failure = error;
          tx.abort();
        },
      );
    } catch (error) {
      failure =
        error instanceof Error || error instanceof DOMException ? error : new Error(String(error));
      tx.abort();
    }
  });
}

export function putApprovedImages(images: Record<string, Blob>): Promise<void> {
  return deviceTransaction(['approved-images'], 'readwrite', (tx) => {
    const store = tx.objectStore('approved-images');
    for (const [key, image] of Object.entries(images)) store.put(image, key);
  });
}
export function getApprovedImage(key: string): Promise<Blob> {
  return deviceTransaction(['approved-images'], 'readonly', (tx, result, fail) => {
    const request = tx.objectStore('approved-images').get(key);
    request.onsuccess = () =>
      request.result instanceof Blob
        ? result(request.result)
        : fail(new Error('This page image is no longer saved on this device.'));
  });
}
export function deleteApprovedImages(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return deviceTransaction(['approved-images'], 'readwrite', (tx) => {
    for (const key of keys) tx.objectStore('approved-images').delete(key);
  });
}

/**
 * Delete the whole on-device database: queue, files, approved page images. Other tabs close
 * their connection on the version change. The caller reloads the page afterwards.
 */
export async function deleteDeviceDatabase(): Promise<void> {
  wiping = true;
  const open = connection;
  connection = undefined;
  await open?.then((db) => db.close()).catch(() => undefined);
  if (typeof indexedDB === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE);
    // Another tab that doesn't let go in time: give up rather than hang.
    const timer = setTimeout(
      () => reject(new Error('Close other Carryover tabs, then try again.')),
      8000,
    );
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error('Local data could not be deleted.'));
    };
  });
}

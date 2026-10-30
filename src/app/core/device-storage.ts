/** Binary files stay in IndexedDB, never in localStorage or a network request. */
const DATABASE = 'carryover.device.v1';
let connection: Promise<IDBDatabase> | undefined;

export function deviceDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Local file storage is unavailable in this browser.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    let expired = false;
    const timeout = setTimeout(() => { expired = true; reject(new Error('Local storage is busy in another tab. Close that tab and retry.')); }, 8000);
    request.onupgradeneeded = () => {
      for (const name of ['queue-state', 'queue-documents', 'approved-images']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onerror = () => { clearTimeout(timeout); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timeout);
      const db = request.result;
      if (expired) { db.close(); return; }
      db.onversionchange = () => { db.close(); connection = undefined; };
      db.onclose = () => { connection = undefined; };
      resolve(db);
    };
  }).catch(error => { connection = undefined; throw error; });
  return connection;
}

export async function deviceTransaction<T>(stores: string[], mode: IDBTransactionMode,
  schedule: (tx: IDBTransaction, result: (value: T) => void, fail: (error: Error) => void) => void): Promise<T> {
  const db = await deviceDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let value: T;
    let failure: Error | undefined;
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Local saving was interrupted. Please retry.'));
    tx.onerror = () => { /* The abort event reports the failure once. */ };
    try { schedule(tx, result => { value = result; }, error => { failure = error; tx.abort(); }); }
    catch (error) { failure = error instanceof Error || error instanceof DOMException ? error : new Error(String(error)); tx.abort(); }
  });
}

export function putApprovedImages(images: Record<string, Blob>): Promise<void> {
  return deviceTransaction(['approved-images'], 'readwrite', tx => {
    const store = tx.objectStore('approved-images');
    for (const [key, image] of Object.entries(images)) store.put(image, key);
  });
}
export function getApprovedImage(key: string): Promise<Blob> {
  return deviceTransaction(['approved-images'], 'readonly', (tx, result, fail) => {
    const request = tx.objectStore('approved-images').get(key);
    request.onsuccess = () => request.result instanceof Blob ? result(request.result)
      : fail(new Error('This page image is no longer saved on this device.'));
  });
}
export function deleteApprovedImages(keys: string[]): Promise<void> {
  if (!keys.length) return Promise.resolve();
  return deviceTransaction(['approved-images'], 'readwrite', tx => {
    for (const key of keys) tx.objectStore('approved-images').delete(key);
  });
}

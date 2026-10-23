const DATABASE = 'aksara-image-transfers';
const STORE = 'images';
let database: Promise<IDBDatabase> | null = null;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Image staging was interrupted.'));
  });
}

export const imageStore = {
  put: (key: string, blob: Blob) => transaction('readwrite', store => store.put(blob, key)),
  get: (key: string) => transaction<Blob | undefined>('readonly', store => store.get(key)),
  delete: (key: string) => transaction('readwrite', store => store.delete(key)),
  clear: () => transaction('readwrite', store => store.clear()),
};

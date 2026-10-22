let database: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("blueprint-workspace-locks", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("locks");
    request.onerror = () => { database = undefined; reject(request.error); };
    request.onsuccess = () => {
      const opened = request.result;
      opened.onversionchange = () => { opened.close(); database = undefined; };
      resolve(opened);
    };
  });
  return database;
}

/** Only coordination metadata lives here; existing drafts keep their storage keys. */
export async function withWorkspaceLock<T>(key: string, change: () => T): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("locks", "readwrite");
    let result: T;
    let failure: unknown;
    const timeout = setTimeout(() => {
      failure = new Error("Another tab is saving this workspace. Keep this board open and retry.");
      transaction.abort();
    }, 10000);
    transaction.oncomplete = () => { clearTimeout(timeout); resolve(result); };
    transaction.onabort = transaction.onerror = () => {
      clearTimeout(timeout);
      reject(failure ?? transaction.error ?? new Error("Could not coordinate saved drafts."));
    };
    const store = transaction.objectStore("locks");
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        // A read/write transaction serializes this read/merge/write across tabs,
        // including browsers without Web Locks. Keep its callback synchronous.
        result = change();
        store.put(true, key);
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
  });
}

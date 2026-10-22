/** One private database per saved device identity; every read/modify/write is one transaction. */
export class OfflineDatabase<T> {
  private opened = new Map<string, Promise<IDBDatabase>>();
  private name: string;
  readonly owner: () => Promise<string | null>;
  constructor(name: string, owner: () => Promise<string | null>) {
    this.name = name;
    this.owner = owner;
  }

  private async database(owner: string): Promise<IDBDatabase> {
    let opened = this.opened.get(owner);
    if (!opened) {
      opened = new Promise((resolve, reject) => {
        const request = indexedDB.open(`${this.name}:${owner}`, 2);
        request.onupgradeneeded = () => {
          const store = request.result.objectStoreNames.contains('records') ? request.transaction!.objectStore('records') : request.result.createObjectStore('records', { keyPath: 'id' });
          if (!store.indexNames.contains('pending')) store.createIndex('pending', 'queued');
          if (!store.indexNames.contains('pageId')) store.createIndex('pageId', 'value.page.id', { unique: true });
        };
        request.onerror = () => reject(request.error ?? new Error('Local saving is unavailable.'));
        request.onblocked = () => reject(new Error('Close older app tabs to enable local saving.'));
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            this.opened.delete(owner);
          };
          resolve(request.result);
        };
      });
      this.opened.set(owner, opened);
      void opened.catch(() => this.opened.delete(owner));
    }
    return opened;
  }

  async read(id: string): Promise<T | undefined> {
    const owner = await this.owner();
    if (!owner) return undefined;
    const db = await this.database(owner);
    return new Promise((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').get(id);
      request.onsuccess = () => resolve(request.result?.value as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async all(pendingOnly = false): Promise<T[]> {
    const owner = await this.owner();
    if (!owner) return [];
    const db = await this.database(owner);
    return new Promise((resolve, reject) => {
      const store = db.transaction('records').objectStore('records');
      const request = pendingOnly ? store.index('pending').getAll(1) : store.getAll();
      request.onsuccess = () => resolve(request.result.map(row => row.value as T));
      request.onerror = () => reject(request.error);
    });
  }

  async page(id: string): Promise<T | undefined> {
    const owner = await this.owner();
    if (!owner) return undefined;
    const db = await this.database(owner);
    return new Promise((resolve, reject) => {
      const request = db.transaction('records').objectStore('records').index('pageId').get(id);
      request.onsuccess = () => resolve(request.result?.value as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  async change(id: string, change: (current: T | undefined) => { value: T; queued: boolean }, expectedOwner?: string): Promise<T> {
    const owner = await this.owner();
    if (!owner) throw new Error('Open this item online once before saving it on this device.');
    if (expectedOwner !== undefined && owner !== expectedOwner) throw new Error('The device session changed. Pending edits stay with their original session.');
    const db = await this.database(owner);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('records', 'readwrite');
      const store = transaction.objectStore('records');
      const request = store.get(id);
      let result: T;
      let failure: unknown;
      request.onsuccess = () => {
        try {
          const next = change(request.result?.value as T | undefined);
          result = next.value;
          store.put({ id, value: next.value, queued: next.queued ? 1 : 0 });
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = transaction.onerror = () => reject(failure ?? transaction.error ?? new Error('Could not save on this device. Your draft is kept.'));
    });
  }
}

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { OfflineDatabase } from './offlineDatabase';
import type { SavedPage } from '../cloud/offline';

const page = { id: '22222222-2222-4222-8222-222222222222', code: 'a'.repeat(32), text: 'Cached', version: 1, updatedAt: '2026-10-18T00:00:00Z' };

describe('offline database upgrade', () => {
  it('adds direct page lookup while preserving legacy cached text, identity and pending edits', async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const queued: SavedPage = { page, pending: { id: crypto.randomUUID(), text: 'Queued offline', at: 1 } };
    await new Promise<void>((resolve, reject) => {
      const opening = indexedDB.open(`${name}:owner`, 1);
      opening.onupgradeneeded = () => {
        const store = opening.result.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('pending', 'queued');
        store.put({ id: page.code, value: queued, queued: 1 });
      };
      opening.onerror = () => reject(opening.error);
      opening.onsuccess = () => {
        opening.result.close();
        resolve();
      };
    });
    const upgraded = new OfflineDatabase<SavedPage>(name, async () => 'owner');
    expect(await upgraded.page(page.id)).toEqual(queued);
    expect(await upgraded.read(page.code)).toEqual(queued);
    expect(await upgraded.all(true)).toEqual([queued]);
    expect(await new OfflineDatabase<SavedPage>(name, async () => 'other').page(page.id)).toBeUndefined();
  });
});

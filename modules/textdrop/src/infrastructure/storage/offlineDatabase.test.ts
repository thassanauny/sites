import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { OfflineDatabase } from './offlineDatabase';
import type { SavedPage } from '../cloud/offline';

const page = { id: '22222222-2222-4222-8222-222222222222', code: 'a'.repeat(32), text: 'Cached', name: null, version: 1, updatedAt: '2026-10-18T00:00:00Z' };

describe('current offline database', () => {
  it('upgrades a version-one cache without losing text, pending edits or their conflict baseline', async () => {
    const name = `upgrade-${crypto.randomUUID()}`;
    const queued: SavedPage = { page, pending: { id: crypto.randomUUID(), text: 'Unsynced text', at: 1, baseVersion: page.version, baseText: page.text } };
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(`${name}:owner`, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('records', { keyPath: 'id' });
        store.createIndex('pending', 'queued');
        store.put({ id: page.code, value: queued, queued: 1 });
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const upgraded = new OfflineDatabase<SavedPage>(name, async () => 'owner');
    expect(await upgraded.read(page.code)).toEqual(queued);
    expect(await upgraded.page(page.id)).toEqual(queued);
    expect(await upgraded.all(true)).toEqual([queued]);
    const newer = { ...queued, pending: { ...queued.pending!, text: 'More offline text' } };
    await upgraded.change(page.code, () => ({ value: newer, queued: true }));
    const reopened = new OfflineDatabase<SavedPage>(name, async () => 'owner');
    expect(await reopened.page(page.id)).toEqual(newer);
    expect(await reopened.all(true)).toEqual([newer]);
  });

  it('reopens current cached text, pending baselines and identity-scoped direct lookup', async () => {
    const name = `current-${crypto.randomUUID()}`;
    const queued: SavedPage = { page, pending: { id: crypto.randomUUID(), text: 'Queued offline', at: 1, baseVersion: page.version, baseText: page.text } };
    const first = new OfflineDatabase<SavedPage>(name, async () => 'owner');
    await first.change(page.code, () => ({ value: queued, queued: true }));
    const reopened = new OfflineDatabase<SavedPage>(name, async () => 'owner');
    expect(await reopened.page(page.id)).toEqual(queued);
    expect(await reopened.read(page.code)).toEqual(queued);
    expect(await reopened.all(true)).toEqual([queued]);
    expect(await new OfflineDatabase<SavedPage>(name, async () => 'other').page(page.id)).toBeUndefined();
  });
});

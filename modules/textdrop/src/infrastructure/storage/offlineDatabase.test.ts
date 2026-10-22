import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { OfflineDatabase } from './offlineDatabase';
import type { SavedPage } from '../cloud/offline';

const page = { id: '22222222-2222-4222-8222-222222222222', code: 'a'.repeat(32), text: 'Cached', name: null, version: 1, updatedAt: '2026-10-18T00:00:00Z' };

describe('current offline database', () => {
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

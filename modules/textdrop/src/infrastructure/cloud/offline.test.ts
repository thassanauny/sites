import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineDatabase } from '../storage/offlineDatabase';
import { withOfflinePages, type SavedPage } from './offline';
import type { Cloud } from '../../application/ports';
import type { TextDropPage } from '../../domain/snippets/model';

const page: TextDropPage = { id: '22222222-2222-4222-8222-222222222222', code: 'a'.repeat(32), text: 'Original', version: 1, updatedAt: '2026-10-18T00:00:00Z' };
let online = true;
let identity = 'first';
let database: OfflineDatabase<SavedPage>;
let current: TextDropPage;
let remote: Cloud;
beforeEach(() => {
  online = true;
  identity = 'first';
  current = { ...page };
  let tail = Promise.resolve();
  vi.stubGlobal('navigator', {
    get onLine() {
      return online;
    },
    locks: {
      request: (_name: string, work: () => Promise<void>) => {
        const next = tail.then(work);
        tail = next.catch(() => {});
        return next;
      },
    },
  });
  database = new OfflineDatabase(`textdrop-test-${crypto.randomUUID()}`, async () => identity);
  remote = {
    createPage: vi.fn(async () => current),
    joinPage: vi.fn(async () => current),
    pollPage: vi.fn(async () => current),
    savePage: vi.fn(async (_id, text) => {
      current = { ...current, text, version: current.version + 1 };
      return current;
    }),
    startNewSession: vi.fn(async () => {}),
  };
});
afterEach(() => vi.unstubAllGlobals());

describe('durable offline text', () => {
  it('survives a new app instance and automatically uploads after reconnecting', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    online = false;
    expect(await cloud.savePage(page.id, 'Offline text')).toMatchObject({ text: 'Offline text', localPending: true });
    const reopened = withOfflinePages(remote, database);
    expect(await reopened.joinPage(page.code)).toMatchObject({ text: 'Offline text', localPending: true });
    expect(remote.savePage).not.toHaveBeenCalled();
    online = true;
    await reopened.syncPending!();
    expect((await reopened.pollPage(page.id, 1))?.text).toBe('Offline text');
    expect(await database.all(true)).toEqual([]);
  });
  it('keeps an edit typed during an upload, including across two tabs', async () => {
    const first = withOfflinePages(remote, database);
    const second = withOfflinePages(remote, database);
    await first.joinPage(page.code);
    online = false;
    await first.savePage(page.id, 'First');
    online = true;
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.mocked(remote.savePage).mockImplementationOnce(async () => {
      started();
      await new Promise<void>(resolve => {
        release = resolve;
      });
      current = { ...current, text: 'First', version: 2 };
      return current;
    });
    const syncing = first.syncPending!();
    await waiting;
    await second.stagePage!(page.id, 'Second');
    release();
    await syncing;
    expect(current.text).toBe('Second');
    expect(await database.all(true)).toEqual([]);
  });
  it('retains failed uploads and separates device identities', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    vi.mocked(remote.savePage).mockRejectedValueOnce(new Error('Network failed'));
    expect(await cloud.savePage(page.id, 'Keep me')).toMatchObject({ text: 'Keep me', localPending: true });
    identity = 'second';
    online = false;
    await expect(cloud.joinPage(page.code)).rejects.toThrow('Open this snippet online once');
    identity = 'first';
    online = true;
    await cloud.syncPending!();
    expect(current.text).toBe('Keep me');
  });
  it('never claims a successful save after a failed local transaction', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    online = false;
    vi.spyOn(database, 'change').mockRejectedValueOnce(new Error('Storage full'));
    await expect(cloud.savePage(page.id, 'Not persisted')).rejects.toThrow('Storage full');
    expect((await database.read(page.code))?.page.text).toBe('Original');
    expect(remote.savePage).not.toHaveBeenCalled();
  });
});

describe('independent offline shared names', () => {
  beforeEach(() => {
    remote.renamePage = vi.fn(async (_id, name) => {
      current = { ...current, name, version: current.version + 1 };
      return current;
    });
    remote.listNames = vi.fn(async () => [{ code: current.code, name: current.name ?? null, version: current.version }]);
  });
  it('keeps an offline name across reload and preserves another person’s newer text', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    online = false;
    expect(await cloud.renamePage!(page.id, 'Shared notes')).toMatchObject({ name: 'Shared notes', localPending: true });
    const reopened = withOfflinePages(remote, database);
    expect(await reopened.joinPage(page.code)).toMatchObject({ name: 'Shared notes', localPending: true });
    current = { ...current, text: 'Text from another person', version: 2 };
    online = true;
    await reopened.syncPending!();
    expect(current).toMatchObject({ name: 'Shared notes', text: 'Text from another person', version: 3 });
    expect(remote.savePage).not.toHaveBeenCalled();
    expect(await database.all(true)).toEqual([]);
  });
  it('does not resend acknowledged text when a name changes during its upload', async () => {
    const first = withOfflinePages(remote, database),
      second = withOfflinePages(remote, database);
    await first.joinPage(page.code);
    online = false;
    await first.savePage(page.id, 'One text edit');
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>(resolve => {
      started = resolve;
    });
    vi.mocked(remote.savePage).mockImplementationOnce(async (_id, text) => {
      started();
      await new Promise<void>(resolve => {
        release = resolve;
      });
      current = { ...current, text, version: 2 };
      return current;
    });
    online = true;
    const syncing = first.syncPending!();
    await waiting;
    online = false;
    await second.renamePage!(page.id, 'Name entered during save');
    online = true;
    release();
    await syncing;
    expect(current).toMatchObject({ text: 'One text edit', name: 'Name entered during save' });
    expect(remote.savePage).toHaveBeenCalledTimes(1);
    expect(remote.renamePage).toHaveBeenCalledTimes(1);
    expect(await database.all(true)).toEqual([]);
  });
  it('keeps failed names with their saved identity and supports clearing a name', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    vi.mocked(remote.renamePage!).mockRejectedValueOnce(new Error('Network failed'));
    expect(await cloud.renamePage!(page.id, 'Keep my name')).toMatchObject({ name: 'Keep my name', localPending: true });
    identity = 'other';
    online = false;
    await expect(cloud.joinPage(page.code)).rejects.toThrow('Open this snippet online once');
    identity = 'first';
    online = true;
    await cloud.syncPending!();
    expect(current.name).toBe('Keep my name');
    await cloud.renamePage!(page.id, null);
    expect(current.name).toBeNull();
    expect(remote.savePage).not.toHaveBeenCalled();
  });
});

it('keeps refreshed names available offline without advancing the cached text version', async () => {
  remote.listNames = vi.fn(async () => [{ code: current.code, name: current.name ?? null, version: current.version }]);
  const cloud = withOfflinePages(remote, database);
  await cloud.joinPage(page.code);
  current = { ...current, name: 'New shared name', text: 'New remote text', version: 2 };
  await cloud.listNames!([page.code]);
  online = false;
  const reopened = withOfflinePages(remote, database);
  expect(await reopened.joinPage(page.code)).toMatchObject({ name: 'New shared name', text: 'Original', version: 1 });
  online = true;
  expect(await reopened.pollPage(page.id, 1)).toMatchObject({ name: 'New shared name', text: 'New remote text', version: 2 });
});

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfflineDatabase } from '../storage/offlineDatabase';
import { withOfflinePages, type SavedPage } from './offline';
import type { Cloud, RemoteCloud } from '../../application/ports';
import { TextConflictError, type TextDropPage } from '../../domain/snippets/model';

const page: TextDropPage = { id: '22222222-2222-4222-8222-222222222222', code: 'a'.repeat(32), text: 'Original', name: null, version: 1, updatedAt: '2026-10-18T00:00:00Z' };
let online = true;
let identity = 'first';
let database: OfflineDatabase<SavedPage>;
let current: TextDropPage;
let remote: Cloud & RemoteCloud;
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
    saveCheckedPage: (id, text) => remote.savePage(id, text),
    renamePage: vi.fn(async (_id, name) => ({ ...current, name })),
    renameCheckedPage: (id, name) => remote.renamePage!(id, name),
    listNames: vi.fn(async () => []),
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
    const newer = second.savePage(page.id, 'Second');
    await vi.waitFor(async () => expect((await database.read(page.code))?.pending?.text).toBe('Second'));
    release();
    await Promise.all([syncing, newer]);
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
  it('reports failed online name reads without changing cached text or queued names, and still reads names offline', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    online = false;
    await cloud.renamePage!(page.id, 'Queued name');
    const saved = await database.read(page.code);
    online = true;
    vi.mocked(remote.listNames!).mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(cloud.listNames!([page.code])).rejects.toThrow('Network unavailable');
    expect(await database.read(page.code)).toEqual(saved);
    online = false;
    expect(await cloud.listNames!([page.code])).toEqual([{ code: page.code, name: 'Queued name', version: page.version }]);
    expect(remote.listNames).toHaveBeenCalledTimes(1);
    expect(remote.renamePage).not.toHaveBeenCalled();
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

describe('checked queued text', () => {
  it.each(['baseVersion', 'baseText'] as const)('keeps a damaged current queue without inventing its missing %s', async field => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    online = false;
    await cloud.saveCheckedPage(page.id, 'Queued text', { baseVersion: page.version, baseText: page.text });
    const original = (await database.read(page.code))!;
    const damaged = structuredClone(original);
    delete (damaged.pending as unknown as Record<string, unknown>)[field];
    await database.change(page.code, () => ({ value: damaged, queued: true }));
    remote.saveCheckedPage = vi.fn(async () => {
      throw new Error('Invalid checked editing baseline');
    });
    online = true;
    await expect(cloud.syncPending!()).rejects.toThrow('Invalid checked editing baseline');
    expect(remote.saveCheckedPage).toHaveBeenCalledExactlyOnceWith(page.id, 'Queued text', {
      baseVersion: field === 'baseVersion' ? undefined : page.version,
      baseText: field === 'baseText' ? undefined : page.text,
      operationId: original.pending!.id,
    });
    expect(await database.read(page.code)).toEqual(damaged);
    expect(current.text).toBe(page.text);
  });
  it('retains both versions across reload and requires an explicit resolution', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    remote.saveCheckedPage = vi.fn(async (_id, text, save) => {
      if (save.baseVersion !== current.version && save.baseText !== current.text) throw new TextConflictError(current);
      current = { ...current, text, version: current.version + 1 };
      return current;
    });
    online = false;
    await cloud.savePage(page.id, 'My offline text');
    current = { ...page, text: 'Other device text', version: 2 };
    online = true;
    await expect(cloud.syncPending!()).rejects.toBeInstanceOf(TextConflictError);
    expect(current.text).toBe('Other device text');
    const reopened = withOfflinePages(remote, database);
    expect(await reopened.joinPage(page.code)).toMatchObject({ text: 'My offline text', localConflict: { text: 'Other device text' } });
    await expect(reopened.syncPending!()).rejects.toBeInstanceOf(TextConflictError);
    expect(remote.saveCheckedPage).toHaveBeenCalledTimes(1);
    const local = await reopened.saveCheckedPage!(page.id, 'Reviewed local text', { baseVersion: 2, baseText: 'Other device text', resolveConflict: true });
    expect(local).toMatchObject({ text: 'Reviewed local text', version: 3 });
    expect(local.localConflict).toBeUndefined();
    expect(await database.all(true)).toEqual([]);
  });
  it('continues another snippet after a blocked conflict and isolates targeted refreshes', async () => {
    const cloud = withOfflinePages(remote, database);
    const other = { ...page, id: '33333333-3333-4333-8333-333333333333', code: 'b'.repeat(32) };
    await cloud.joinPage(page.code);
    current = other;
    await cloud.joinPage(other.code);
    online = false;
    await cloud.savePage(page.id, 'Blocked edit');
    await cloud.savePage(other.id, 'Valid edit');
    remote.saveCheckedPage = vi.fn(async (id, text) => {
      if (id === page.id) throw new TextConflictError({ ...page, text: 'Remote update', version: 2 });
      return { ...other, text, version: 2 };
    });
    online = true;
    await expect(cloud.syncPending!()).rejects.toBeInstanceOf(TextConflictError);
    expect((await database.read(other.code))?.pending).toBeUndefined();
    expect((await database.read(page.code))?.pending?.text).toBe('Blocked edit');
    await expect(cloud.pollPage(other.id, 1)).resolves.toBeDefined();
  });
  it('keeps a stable operation and original baseline after a lost response', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    remote.saveCheckedPage = vi.fn(async () => {
      throw new Error('Network failed');
    });
    await cloud.savePage(page.id, 'Retry safely');
    await expect(cloud.syncPending!()).rejects.toThrow('Network failed');
    const calls = vi.mocked(remote.saveCheckedPage).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0]![2]).toEqual(calls[1]![2]);
    expect(calls[0]![2]).toMatchObject({ baseVersion: 1, baseText: 'Original', operationId: expect.any(String) });
  });
  it('does not scan unrelated cached text to save, rename or poll one snippet', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    const all = vi.spyOn(database, 'all');
    online = false;
    await cloud.savePage(page.id, 'Direct lookup');
    expect(all).not.toHaveBeenCalled();
    await cloud.listNames!([page.code]);
    expect(all).not.toHaveBeenCalled();
  });
  it('uses the shared version only on explicit discard and rejects a newer local edit from another tab', async () => {
    const cloud = withOfflinePages(remote, database);
    await cloud.joinPage(page.code);
    online = false;
    await cloud.savePage(page.id, 'Keep until chosen');
    await database.change(page.code, entry => ({ value: { ...entry!, conflict: { ...page, text: 'Shared', version: 2 } }, queued: true }));
    await expect(cloud.acceptSharedPage!(page.id, 'Older local text')).rejects.toThrow('another tab');
    expect((await database.read(page.code))?.pending?.text).toBe('Keep until chosen');
    expect(await cloud.acceptSharedPage!(page.id, 'Keep until chosen')).toMatchObject({ text: 'Shared', version: 2 });
    expect(await database.all(true)).toEqual([]);
  });
});

it.each(['save', 'rename', 'accept'] as const)('refuses %s across a saved-identity change between lookup and transaction', async action => {
  const cloud = withOfflinePages(remote, database);
  await cloud.joinPage(page.code);
  online = false;
  await cloud.savePage(page.id, 'First identity draft');
  await database.change(page.code, entry => ({ value: { ...entry!, conflict: { ...page, text: 'Shared', version: 2 } }, queued: true }));
  const first = await database.read(page.code);
  identity = 'second';
  await database.change(page.code, () => ({
    value: { page, pending: { id: crypto.randomUUID(), text: 'Second identity draft', at: 1, baseVersion: page.version, baseText: page.text }, conflict: { ...page, text: 'Shared', version: 2 } },
    queued: true,
  }));
  const second = await database.read(page.code);
  identity = 'first';
  const lookup = database.page.bind(database);
  vi.spyOn(database, 'page').mockImplementationOnce(async id => {
    const result = await lookup(id);
    identity = 'second';
    return result;
  });
  await expect(
    action === 'save' ? cloud.savePage(page.id, 'Replacement') : action === 'rename' ? cloud.renamePage!(page.id, 'New name') : cloud.acceptSharedPage!(page.id, 'First identity draft'),
  ).rejects.toThrow('session changed');
  expect(await database.read(page.code)).toEqual(second);
  identity = 'first';
  expect(await database.read(page.code)).toEqual(first);
});

it('rejects a stale tab before replacing another tab’s acknowledged offline text, but coalesces sequential edits', async () => {
  const cloud = withOfflinePages(remote, database);
  await cloud.joinPage(page.code);
  online = false;
  const original = { baseVersion: 1, baseText: 'Original' };
  expect(await cloud.saveCheckedPage!(page.id, 'First tab text', original)).toMatchObject({ text: 'First tab text', localPending: true });
  await expect(cloud.saveCheckedPage!(page.id, 'Stale second tab text', original)).rejects.toThrow('Newer text was saved in another tab');
  expect((await database.read(page.code))?.pending?.text).toBe('First tab text');
  expect(await withOfflinePages(remote, database).joinPage(page.code)).toMatchObject({ text: 'First tab text', localPending: true });
  expect(await cloud.saveCheckedPage!(page.id, 'Next first tab edit', { baseVersion: 1, baseText: 'First tab text' })).toMatchObject({ text: 'Next first tab edit', localPending: true });
  expect(remote.savePage).not.toHaveBeenCalled();
});

it.each(['create', 'join', 'failed join', 'poll', 'unchanged poll'] as const)('rejects a delayed %s response after an identity change without mixing either cache', async action => {
  const cloud = withOfflinePages(remote, database);
  await cloud.joinPage(page.code);
  online = false;
  await cloud.savePage(page.id, 'Original identity pending text');
  const original = await database.read(page.code);
  identity = 'second';
  await database.change(page.code, () => ({ value: { page: { ...page, text: 'Second identity text', version: 5 } }, queued: false }));
  const second = await database.read(page.code);
  identity = 'first';
  online = true;
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>(resolve => {
    started = resolve;
  });
  const response = async () => {
    started();
    await new Promise<void>(resolve => {
      release = resolve;
    });
    return { ...page, text: 'Delayed first identity data', version: 6 };
  };
  vi.spyOn(database, 'all').mockResolvedValue([]);
  if (action === 'create') vi.mocked(remote.createPage).mockImplementationOnce(response);
  else if (action === 'join' || action === 'failed join')
    vi.mocked(remote.joinPage).mockImplementationOnce(async () => {
      const result = await response();
      if (action === 'failed join') throw new Error('Network failed');
      return result;
    });
  else
    vi.mocked(remote.pollPage).mockImplementationOnce(async () => {
      const result = await response();
      return action === 'unchanged poll' ? null : result;
    });
  const request = action === 'create' ? cloud.createPage(page.id) : action === 'join' || action === 'failed join' ? cloud.joinPage(page.code) : cloud.pollPage(page.id, 1);
  const rejected = expect(request).rejects.toThrow('session changed');
  await waiting;
  identity = 'second';
  release();
  await rejected;
  expect(await database.read(page.code)).toEqual(second);
  identity = 'first';
  expect(await database.read(page.code)).toEqual(original);
});

it.each(['save', 'rename'] as const)('rejects a delayed %s acknowledgement after identity changes and preserves the original queue', async action => {
  const cloud = withOfflinePages(remote, database);
  await cloud.joinPage(page.code);
  let release!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => {
    started = resolve;
  });
  const response = async () => {
    started();
    await new Promise<void>(resolve => {
      release = resolve;
    });
    return { ...page, text: 'Acknowledged text', name: 'Acknowledged name', version: 2 };
  };
  if (action === 'save') vi.mocked(remote.savePage).mockImplementationOnce(response);
  else remote.renamePage = vi.fn(response);
  const request = action === 'save' ? cloud.savePage(page.id, 'Original queued text') : cloud.renamePage!(page.id, 'Original queued name');
  const rejected = expect(request).rejects.toThrow('session changed');
  await waiting;
  const first = await database.read(page.code);
  identity = 'second';
  await database.change(page.code, () => ({ value: { page: { ...page, text: 'Second identity text', version: 5 } }, queued: false }));
  const second = await database.read(page.code);
  release();
  await rejected;
  expect(await database.read(page.code)).toEqual(second);
  identity = 'first';
  expect(await database.read(page.code)).toEqual(first);
});

it('establishes the first saved identity before caching a newly created snippet', async () => {
  let savedIdentity: string | null = null;
  const firstDatabase = new OfflineDatabase<SavedPage>(`textdrop-first-${crypto.randomUUID()}`, async () => savedIdentity);
  remote.initialize = vi.fn(async () => {
    savedIdentity = 'new-session';
  });
  const cloud = withOfflinePages(remote, firstDatabase);
  expect(await cloud.createPage(page.id)).toEqual(page);
  expect(remote.initialize).toHaveBeenCalledOnce();
  expect(await firstDatabase.read(page.code)).toEqual({ page });
});

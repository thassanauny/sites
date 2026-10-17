import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Operation } from '../../domain/boards/types';
import { applyOfflineOperation } from '../../domain/boards/offline';
import { summarizeBoard } from '../../domain/boards/summary';
import { OfflineDatabase } from '../storage/offlineDatabase';
import { withOfflineBoards, type Entry } from './offlineBoards';
const original: Board = {
  id: '22222222-2222-4222-8222-222222222222',
  invite_code: 'a'.repeat(32),
  title: 'Original',
  description: '',
  columns: [
    { id: 'todo', title: 'To do', color: 'slate' },
    { id: 'done', title: 'Done', color: 'emerald' },
  ],
  cards: [],
  revision: 1,
  created_at: '2026-10-18T00:00:00Z',
  updated_at: '2026-10-18T00:00:00Z',
};
let online = true;
let identity = 'first';
let database: OfflineDatabase<Entry>;
let current: Board;
const mutate = vi.fn<(id: string, operation: Operation) => Promise<Board>>();
beforeEach(() => {
  online = true;
  identity = 'first';
  current = structuredClone(original);
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
  database = new OfflineDatabase(`pinboard-test-${crypto.randomUUID()}`, async () => identity);
  mutate.mockReset().mockImplementation(async (_id, operation) => {
    const { localPending: _pending, ...next } = applyOfflineOperation(current, operation);
    current = { ...next, revision: current.revision + 1 };
    return current;
  });
});
afterEach(() => vi.unstubAllGlobals());
function open() {
  return withOfflineBoards(
    {
      loadBoardList: async () => [summarizeBoard(current)],
      loadBoard: async () => current,
      createBoard: async () => current,
      joinBoard: async () => current,
      mutateBoard: mutate,
    },
    database,
  );
}

describe('durable offline boards', () => {
  it('keeps rejected operations available after reload and clears cached errors after a successful retry', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    mutate.mockRejectedValueOnce(new Error('That card was removed.'));
    await expect(
      cloud.mutateBoard(original.id, { type: 'update_board', patch: { title: 'Kept draft' } }),
    ).rejects.toThrow('removed');
    mutate.mockRejectedValueOnce(new Error('That card was removed.'));
    expect((await open().loadBoardList())[0]).toMatchObject({
      title: 'Kept draft',
      localPending: true,
      localError: 'That card was removed.',
    });
    const summaries = await open().loadBoardList();
    expect(summaries[0]).not.toHaveProperty('localError');
    expect(current.title).toBe('Kept draft');
  });
  it('keeps ordered operations through reload and syncs from Home without replacing remote fields', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Offline title' },
    });
    const reopened = open();
    expect(await reopened.loadBoard(original.id)).toMatchObject({
      title: 'Offline title',
      localPending: true,
    });
    expect((await reopened.loadBoardList())[0]?.title).toBe('Offline title');
    expect(mutate).not.toHaveBeenCalled();
    current.description = 'Another device changed this';
    online = true;
    await reopened.loadBoardList();
    expect(current).toMatchObject({
      title: 'Offline title',
      description: 'Another device changed this',
    });
    expect(await database.all(true)).toEqual([]);
  });
  it('does not acknowledge a newer operation appended from another tab during upload', async () => {
    const first = open();
    const second = open();
    await first.loadBoard(original.id);
    online = false;
    await first.mutateBoard(original.id, { type: 'update_board', patch: { title: 'First' } });
    online = true;
    let started!: () => void;
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    mutate.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      current = { ...current, title: 'First', revision: 2 };
      return current;
    });
    const upload = first.loadBoardList();
    await waiting;
    online = false;
    await second.mutateBoard(original.id, {
      type: 'update_board',
      patch: { description: 'Second' },
    });
    online = true;
    release();
    await upload;
    expect(current).toMatchObject({ title: 'First', description: 'Second' });
    expect(await database.all(true)).toEqual([]);
  });
  it('retains failures, separates identities, and refuses an uncommitted local save', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    mutate.mockRejectedValueOnce(new Error('Network failed'));
    expect(
      await cloud.mutateBoard(original.id, { type: 'update_board', patch: { title: 'Keep me' } }),
    ).toMatchObject({ localPending: true });
    online = false;
    identity = 'second';
    expect(await cloud.loadBoardList()).toEqual([]);
    identity = 'first';
    vi.spyOn(database, 'change').mockRejectedValueOnce(new Error('Storage full'));
    await expect(
      cloud.mutateBoard(original.id, { type: 'update_board', patch: { title: 'Not persisted' } }),
    ).rejects.toThrow('Storage full');
    expect((await cloud.loadBoard(original.id)).title).toBe('Keep me');
    online = true;
    await cloud.loadBoardList();
    expect(current.title).toBe('Keep me');
  });
  it('safely retries a column deletion after its response was lost', async () => {
    current.cards = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        title: 'Task',
        description: '',
        columnId: 'todo',
        position: 1024,
        priority: 'medium',
        assignee: '',
        dueDate: '',
        labels: [],
      },
    ];
    const cloud = open();
    await cloud.loadBoard(original.id);
    mutate.mockImplementationOnce(async (_id, operation) => {
      const { localPending: _pending, ...saved } = applyOfflineOperation(current, operation);
      current = { ...saved, revision: 2 };
      throw new Error('Network response lost');
    });
    await cloud.mutateBoard(original.id, {
      type: 'delete_column',
      id: 'todo',
      targetColumnId: 'done',
    });
    await open().loadBoardList();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(current.cards[0]?.columnId).toBe('done');
    expect(await database.all(true)).toEqual([]);
  });
});

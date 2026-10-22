import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Operation } from '../../domain/boards/types';
import { applyOfflineOperation } from '../../domain/boards/offline';
import { summarizeBoard } from '../../domain/boards/summary';
import { OfflineDatabase } from '../storage/offlineDatabase';
import {
  BoardOperationError,
  BoardSyncUnavailableError,
  withOfflineBoards,
  type Entry,
} from './offlineBoards';
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
const recoveryRemote = {
  copyBoard: vi.fn<(id: string, source: Board) => Promise<Board>>(),
  forceBoard:
    vi.fn<(id: string, token: string, source: Board, revision: number) => Promise<Board>>(),
};
const mutate =
  vi.fn<
    (
      id: string,
      operation: Operation,
      operationId?: string,
      baseRevision?: number,
      known?: Board,
    ) => Promise<Board>
  >();
beforeEach(() => {
  online = true;
  identity = 'first';
  current = structuredClone(original);
  recoveryRemote.copyBoard.mockReset().mockImplementation(async (id, source) => ({
    ...source,
    id,
    invite_code: 'b'.repeat(32),
    revision: 1,
  }));
  recoveryRemote.forceBoard.mockReset().mockImplementation(async (_id, _token, source) => {
    current = { ...structuredClone(source), revision: current.revision + 1 };
    return current;
  });
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
      ...recoveryRemote,
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
  const newCard = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Created offline',
    description: '',
    columnId: 'todo',
    position: 1024,
    priority: 'medium' as const,
    assignee: '',
    dueDate: '',
    labels: [],
  };
  it('keeps a force request and original queue until acknowledgement, then preserves newer local and shared edits', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Device version' },
    });
    online = true;
    current = { ...current, description: 'Shared before force', revision: 2 };
    const review = await cloud.reviewPendingBoard(original.id);
    let first = true;
    recoveryRemote.forceBoard.mockImplementation(async (_id, _token, source) => {
      if (first) {
        first = false;
        current = {
          ...source,
          revision: 3,
          description: 'Collaborator changed this after force committed',
        };
        throw new Error('Network response lost');
      }
      return current;
    });
    await expect(cloud.forcePendingBoard(review)).rejects.toThrow('Network response lost');
    const uncertain = await database.read(original.id);
    expect(uncertain?.pending.map((change) => change.id)).toEqual(review.pendingIds);
    expect(uncertain?.force?.board.title).toBe('Device version');
    expect(uncertain?.backups).toHaveLength(1);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Typed while force was awaiting acknowledgement' },
    });
    expect((await database.read(original.id))?.pending).toHaveLength(2);
    online = true;
    await open().loadBoardList(); // A reload uses the durable force token and snapshot.
    const [firstCall, retry] = recoveryRemote.forceBoard.mock.calls;
    expect(retry).toEqual(firstCall);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(current).toMatchObject({
      title: 'Typed while force was awaiting acknowledgement',
      description: 'Collaborator changed this after force committed',
    });
    expect((await database.read(original.id))?.force).toBeUndefined();
    expect((await database.read(original.id))?.pending).toEqual([]);
  });
  it('never sends force sync when its durable recovery copy cannot be saved or another tab changed the queue', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    const review = await cloud.reviewPendingBoard(original.id);
    vi.spyOn(database, 'change').mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(cloud.forcePendingBoard(review)).rejects.toThrow('Quota exceeded');
    expect(recoveryRemote.forceBoard).not.toHaveBeenCalled();
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Another tab draft' },
    });
    online = true;
    await expect(cloud.forcePendingBoard(review)).rejects.toThrow('Device edits changed');
    expect(recoveryRemote.forceBoard).not.toHaveBeenCalled();
    expect((await database.read(original.id))?.pending).toHaveLength(1);
  });
  it('copies recovered deleted-card edits without clearing the original recovery or queue', async () => {
    current = { ...current, cards: [newCard] };
    const cloud = open();
    const opened = await cloud.loadBoard(original.id);
    current = { ...current, cards: [], revision: 2 };
    await cloud.loadBoard(original.id);
    await expect(
      cloud.mutateBoard(
        original.id,
        { type: 'update_card', id: newCard.id, patch: { title: 'Recovered task' } },
        { ...opened, cards: [{ ...newCard, title: 'Recovered task' }] },
      ),
    ).rejects.toThrow('backed up');
    const before = await database.read(original.id),
      id = crypto.randomUUID();
    const copied = await cloud.copyBoard(id, { ...opened, title: 'Recovery (copy)' });
    expect(copied.id).toBe(id);
    expect(copied.cards[0].title).toBe('Recovered task');
    expect(current.cards).toEqual([]);
    const after = await database.read(original.id);
    expect(after?.pending).toEqual(before?.pending);
    expect(after?.unappliedBackupId).toBe(before?.unappliedBackupId);
    expect(after?.backups?.some((backup) => backup.id === id)).toBe(true);
  });
  it('automatically uploads an offline card creation and later edit in order with their original IDs', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, { type: 'create_card', card: newCard });
    await cloud.mutateBoard(original.id, {
      type: 'update_card',
      id: newCard.id,
      patch: { title: 'Edited before upload' },
    });
    const pending = (await database.read(original.id))!.pending;
    expect(pending).toHaveLength(2);
    online = true;
    const saved = await open().loadBoard(original.id);
    expect(saved.cards).toEqual([{ ...newCard, title: 'Edited before upload' }]);
    expect(mutate.mock.calls).toEqual(
      pending.map((change, index) => [
        original.id,
        change.operation,
        change.id,
        change.baseRevision,
        expect.objectContaining({ revision: index + 1, cards: index === 0 ? [] : [newCard] }),
      ]),
    );
    expect((await database.read(original.id))?.pending).toEqual([]);
    expect((await database.read(original.id))?.backups).toBeUndefined();
  });
  it.each(['never accepted', 'accepted before a lost reply'] as const)(
    'keeps an expired unconfirmed creation and its later edit for recovery (%s)',
    async (acceptance) => {
      const cloud = open();
      await cloud.loadBoard(original.id);
      online = acceptance !== 'never accepted';
      if (online) {
        mutate.mockImplementationOnce(async (_id, operation) => {
          current = { ...applyOfflineOperation(current, operation), revision: 2 };
          throw new TypeError('Failed to fetch');
        });
      }
      await cloud.mutateBoard(original.id, { type: 'create_card', card: newCard });
      online = false;
      await cloud.mutateBoard(original.id, {
        type: 'update_card',
        id: newCard.id,
        patch: { title: 'Keep this unconfirmed edit' },
      });
      const pending = (await database.read(original.id))!.pending;
      // The public projection cannot distinguish these histories once the
      // creation receipt and the deletion tombstone have expired.
      current = { ...current, cards: [], revision: 1002 };
      mutate.mockRejectedValue(new BoardOperationError('This saved edit is too old to retry.'));
      online = true;
      await cloud.loadBoard(original.id);
      const review = await open().reviewPendingBoard(original.id);
      expect(review.local.cards).toEqual([{ ...newCard, title: 'Keep this unconfirmed edit' }]);
      expect(review.shared.cards).toEqual([]);
      expect(review.retryError).toContain('may not have synced');
      expect(review.retryError).not.toContain('A card in this draft was removed.');
      const calls = mutate.mock.calls.length;
      await expect(cloud.resolvePendingBoard(review, 'retry')).rejects.toThrow(
        'cannot safely recreate',
      );
      expect(mutate).toHaveBeenCalledTimes(calls);
      expect((await database.read(original.id))?.pending).toEqual(pending);
      await cloud.resolvePendingBoard(review, 'discard');
      const saved = await database.read(original.id);
      expect(saved?.pending).toEqual([]);
      expect(saved?.backups?.[0]?.board.cards).toEqual([
        { ...newCard, title: 'Keep this unconfirmed edit' },
      ]);
      expect(current.cards).toEqual([]);
    },
  );
  it('allows reviewed queued creation and edits when the shared card still exists', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, { type: 'create_card', card: newCard });
    await cloud.mutateBoard(original.id, {
      type: 'update_card',
      id: newCard.id,
      patch: { title: 'Reviewed card edit' },
    });
    current = {
      ...current,
      cards: [{ ...newCard, description: 'Independent shared note' }],
      revision: 1002,
    };
    online = true;
    const review = await cloud.reviewPendingBoard(original.id);
    expect(review.retryError).toBeUndefined();
    const saved = await cloud.resolvePendingBoard(review, 'retry');
    expect(saved.cards).toEqual([
      { ...newCard, title: 'Reviewed card edit', description: 'Independent shared note' },
    ]);
    expect((await database.read(original.id))?.pending).toEqual([]);
    expect((await database.read(original.id))?.backups).toHaveLength(1);
  });
  it.each(['queued first', 'cached deletion first'] as const)(
    'retains an explicit downloadable recovery after a card deletion (%s)',
    async (order) => {
      const card = {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        title: 'Original card',
        description: 'Original note',
        columnId: 'todo',
        position: 1024,
        priority: 'medium' as const,
        assignee: '',
        dueDate: '',
        labels: [],
      };
      current = { ...current, cards: [card] };
      const cloud = open();
      await cloud.loadBoard(original.id);
      const edited = {
        ...card,
        title: '  Edited title  ',
        description: '  Exact draft\nwith trailing spaces  ',
        labels: ['kept'],
      };
      const recovery = { ...current, cards: [edited] };
      const operation: Operation = {
        type: 'update_card',
        id: card.id,
        patch: {
          title: edited.title.trim(),
          description: edited.description.trim(),
          labels: edited.labels,
        },
      };
      current = { ...current, cards: [], revision: 2 };
      if (order === 'queued first') {
        online = false;
        await cloud.mutateBoard(original.id, operation, recovery);
        online = true;
        mutate.mockRejectedValue(new BoardOperationError('That card was removed.'));
        await cloud.loadBoard(original.id);
      } else {
        await cloud.loadBoard(original.id);
        await expect(cloud.mutateBoard(original.id, operation, recovery)).rejects.toThrow(
          'backed up on this device',
        );
        expect(mutate).not.toHaveBeenCalled();
      }
      const held = await database.read(original.id);
      expect(held?.pending).toHaveLength(order === 'queued first' ? 1 : 0);
      expect(current.cards).toEqual([]);
      const reloaded = open();
      const review = await reloaded.reviewPendingBoard(original.id);
      expect(review.local.cards.find((item) => item.id === card.id)).toEqual(edited);
      expect(review.shared.cards).toEqual([]);
      expect(review.retryError).toContain('removed');
      await expect(reloaded.resolvePendingBoard(review, 'retry')).rejects.toThrow('removed');
      expect((await database.read(original.id))?.pending.map((change) => change.id)).toEqual(
        held?.pending.map((change) => change.id),
      );
      await reloaded.resolvePendingBoard(review, 'discard');
      const saved = await database.read(original.id);
      expect(saved?.pending).toEqual([]);
      expect(saved?.unappliedBackupId).toBeUndefined();
      expect(saved?.board?.cards).toEqual([]);
      expect(saved?.backups).toHaveLength(1);
      expect(saved?.backups?.[0]?.board.cards.find((item) => item.id === card.id)).toEqual(edited);
      expect((await open().reviewPendingBoard(original.id)).backups[0]?.board.cards[0]).toEqual(
        edited,
      );
      expect(current.cards).toEqual([]);
    },
  );
  it('keeps unapplied recovery atomic, identity-scoped, and rejects an outdated recovery choice', async () => {
    const card = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Deleted draft',
      description: '',
      columnId: 'todo',
      position: 1024,
      priority: 'medium' as const,
      assignee: '',
      dueDate: '',
      labels: [],
    };
    const recovery = { ...current, cards: [card] };
    const cloud = open();
    await cloud.loadBoard(original.id);
    const operation: Operation = { type: 'update_card', id: card.id, patch: { title: card.title } };
    const change = database.change.bind(database);
    vi.spyOn(database, 'change').mockRejectedValueOnce(new Error('Storage full'));
    await expect(cloud.mutateBoard(original.id, operation, recovery)).rejects.toThrow(
      'Storage full',
    );
    expect((await database.read(original.id))?.backups).toBeUndefined();
    vi.mocked(database.change).mockImplementation(change);
    await expect(cloud.mutateBoard(original.id, operation, recovery)).rejects.toThrow('backed up');
    const review = await cloud.reviewPendingBoard(original.id);
    await expect(cloud.mutateBoard(original.id, operation, recovery)).rejects.toThrow('backed up');
    expect((await database.read(original.id))?.backups).toHaveLength(1);
    const newer = { ...recovery, cards: [{ ...card, title: 'Newer deleted draft' }] };
    await expect(cloud.mutateBoard(original.id, operation, newer)).rejects.toThrow('backed up');
    await expect(cloud.resolvePendingBoard(review, 'discard')).rejects.toThrow('another tab');
    identity = 'second';
    expect(await database.all()).toEqual([]);
    await expect(cloud.resolvePendingBoard(review, 'discard')).rejects.toThrow('session changed');
    identity = 'first';
    const latest = await cloud.reviewPendingBoard(original.id);
    expect(latest.local.cards[0]?.title).toBe('Newer deleted draft');
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { description: 'Another queued field' },
    });
    online = true;
    await expect(cloud.resolvePendingBoard(latest, 'discard')).rejects.toThrow('another tab');
    const withQueued = await cloud.reviewPendingBoard(original.id);
    expect(withQueued.local.description).toBe('Another queued field');
    expect(withQueued.local.cards[0]?.title).toBe('Newer deleted draft');
    await cloud.resolvePendingBoard(withQueued, 'discard');
    expect((await database.read(original.id))?.backups).toHaveLength(3);
    expect((await database.read(original.id))?.backups?.at(-1)?.board.description).toBe(
      'Another queued field',
    );
    expect(mutate).not.toHaveBeenCalled();
  });
  it.each(['detail', 'summaries', 'create', 'join', 'uncached save'] as const)(
    'rejects a delayed %s response after identity changes without populating the new cache',
    async (kind) => {
      let release!: () => void;
      let started!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const delayed = async () => {
        started();
        await held;
        return current;
      };
      const cloud = withOfflineBoards(
        {
          ...recoveryRemote,
          loadBoard: delayed,
          loadBoardList: async () => [summarizeBoard(await delayed())],
          createBoard: delayed,
          joinBoard: delayed,
          mutateBoard: delayed,
        },
        database,
      );
      const requests = {
        detail: () => cloud.loadBoard(original.id),
        summaries: () => cloud.loadBoardList(),
        create: () => cloud.createBoard(original.id, 'Private first identity', ''),
        join: () => cloud.joinBoard(original.invite_code),
        'uncached save': () =>
          cloud.mutateBoard(original.id, {
            type: 'update_board',
            patch: { title: 'Private first identity' },
          }),
      };
      const request = requests[kind]();
      const rejected = expect(request).rejects.toThrow('device session changed');
      await waiting;
      identity = 'second';
      expect(await database.all()).toEqual([]);
      release();
      await rejected;
      expect(await database.all()).toEqual([]);
      identity = 'first';
      expect(await database.all()).toEqual([]);
    },
  );
  it('establishes a first identity before a create request and preserves its cache', async () => {
    let session: string | null = null;
    const fresh = new OfflineDatabase<Entry>(
      `pinboard-first-${crypto.randomUUID()}`,
      async () => session,
    );
    const initialize = vi.fn(async () => {
      session = 'first';
    });
    const createBoard = vi.fn(async () => current);
    const cloud = withOfflineBoards(
      {
        ...recoveryRemote,
        initialize,
        createBoard,
        loadBoard: async () => current,
        loadBoardList: async () => [summarizeBoard(current)],
        joinBoard: async () => current,
        mutateBoard: mutate,
      },
      fresh,
    );
    expect(await cloud.createBoard(original.id, original.title, original.description)).toEqual(
      current,
    );
    expect(initialize).toHaveBeenCalledOnce();
    expect(createBoard).toHaveBeenCalledWith(original.id, original.title, original.description);
    expect((await fresh.read(original.id))?.board).toEqual(current);
  });
  it('keeps an acknowledged upload with its old identity when a response arrives after a session switch', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    mutate.mockImplementationOnce(async () => {
      started();
      await held;
      return { ...current, title: 'Accepted old edit', revision: 2 };
    });
    const request = cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Accepted old edit' },
    });
    const rejected = expect(request).rejects.toThrow('device session changed');
    await waiting;
    identity = 'second';
    release();
    await rejected;
    expect(await database.all()).toEqual([]);
    identity = 'first';
    expect((await database.read(original.id))?.pending).toHaveLength(1);
    expect((await database.read(original.id))?.draft?.title).toBe('Accepted old edit');
  });
  it.each(['review', 'resolution'] as const)(
    'rejects an identity switch during the final %s cache read',
    async (kind) => {
      const cloud = open();
      await cloud.loadBoard(original.id);
      online = false;
      await cloud.mutateBoard(original.id, {
        type: 'update_board',
        patch: { title: 'Keep with the old identity' },
      });
      online = true;
      const review = await cloud.reviewPendingBoard(original.id);
      let started!: () => void;
      let release!: () => void;
      const waiting = new Promise<void>((resolve) => {
        started = resolve;
      });
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = database.read.bind(database);
      vi.spyOn(database, 'read').mockImplementationOnce(async (id) => {
        const value = await read(id);
        started();
        await held;
        return value;
      });
      const request =
        kind === 'review'
          ? cloud.reviewPendingBoard(original.id)
          : cloud.resolvePendingBoard(review, 'discard');
      const rejected = expect(request).rejects.toThrow('device session changed');
      await waiting;
      identity = 'second';
      release();
      await rejected;
      expect(await database.all()).toEqual([]);
      identity = 'first';
      const retained = await database.read(original.id);
      if (kind === 'review') expect(retained?.pending).toHaveLength(1);
      else expect(retained?.backups?.[0]?.board.title).toBe('Keep with the old identity');
    },
  );
  it('explicitly retries reviewed expired edits with fresh IDs while retaining a durable local backup', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Reviewed local title' },
    });
    const old = (await database.read(original.id))!.pending[0]!;
    current = {
      ...current,
      title: 'Latest shared title',
      description: 'Independent shared note',
      revision: 1002,
    };
    online = true;
    const review = await cloud.reviewPendingBoard(original.id);
    expect(review.local.title).toBe('Reviewed local title');
    expect(review.shared.title).toBe('Latest shared title');
    expect(mutate).not.toHaveBeenCalled();
    const result = await cloud.resolvePendingBoard(review, 'retry');
    expect(result).toMatchObject({
      title: 'Reviewed local title',
      description: 'Independent shared note',
    });
    expect(mutate).toHaveBeenCalledWith(
      original.id,
      old.operation,
      expect.any(String),
      1002,
      expect.objectContaining({ revision: 1002 }),
    );
    expect(mutate.mock.calls[0]![2]).not.toBe(old.id);
    expect((await database.read(original.id))?.backups?.[0]?.board.title).toBe(
      'Reviewed local title',
    );
    await open().loadBoard(original.id);
    expect((await database.read(original.id))?.backups).toHaveLength(1);
    expect(await database.all(true)).toEqual([]);
  });
  it('uses the reviewed shared board only after durable backup and preserves that backup through reload', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Keep in backup' },
    });
    current = { ...current, title: 'Shared board', revision: 2 };
    online = true;
    const review = await cloud.reviewPendingBoard(original.id);
    const change = database.change.bind(database);
    vi.spyOn(database, 'change').mockRejectedValueOnce(new Error('Storage full'));
    await expect(cloud.resolvePendingBoard(review, 'discard')).rejects.toThrow('Storage full');
    expect((await database.read(original.id))?.pending).toHaveLength(1);
    vi.mocked(database.change).mockImplementation(change);
    expect(await cloud.resolvePendingBoard(review, 'discard')).toMatchObject({
      title: 'Shared board',
      revision: 2,
    });
    expect(mutate).not.toHaveBeenCalled();
    expect((await open().reviewPendingBoard(original.id)).backups[0]?.board.title).toBe(
      'Keep in backup',
    );
    expect(await database.all(true)).toEqual([]);
  });
  it('refuses a review changed by another tab, a newer shared revision or another identity', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'First saved draft' },
    });
    online = true;
    const review = await cloud.reviewPendingBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { description: 'Added in another tab' },
    });
    online = true;
    await expect(cloud.resolvePendingBoard(review, 'discard')).rejects.toThrow('another tab');
    const refreshed = await cloud.reviewPendingBoard(original.id);
    current = { ...current, revision: 2 };
    await expect(cloud.resolvePendingBoard(refreshed, 'retry')).rejects.toThrow(
      'shared board changed',
    );
    identity = 'second';
    await expect(cloud.resolvePendingBoard(refreshed, 'discard')).rejects.toThrow(
      'session changed',
    );
    identity = 'first';
    expect((await database.read(original.id))?.pending).toHaveLength(2);
    expect((await database.read(original.id))?.backups).toBeUndefined();
  });
  it('keeps rejected operations available after reload and clears cached errors after a successful retry', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    mutate.mockRejectedValueOnce(new BoardOperationError('That card was removed.'));
    await expect(
      cloud.mutateBoard(original.id, { type: 'update_board', patch: { title: 'Kept draft' } }),
    ).rejects.toThrow('removed');
    mutate.mockRejectedValueOnce(new BoardOperationError('That card was removed.'));
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
    // The checked endpoint recognizes the accepted operation ID and returns
    // current state; a missing column alone is not proof of acknowledgement.
    current = { ...current, title: 'A later collaborator edit', revision: 3 };
    mutate.mockImplementationOnce(async () => current);
    await open().loadBoardList();
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(mutate.mock.calls[1]).toEqual(mutate.mock.calls[0]);
    expect(current.title).toBe('A later collaborator edit');
    expect(current.cards[0]?.columnId).toBe('done');
    expect(await database.all(true)).toEqual([]);
  });
  it('retains an unacknowledged deletion when another member already removed its column', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    const operation: Operation = { type: 'delete_column', id: 'todo', targetColumnId: 'done' };
    await cloud.mutateBoard(original.id, operation);
    const pending = (await database.read(original.id))!.pending;
    current = { ...applyOfflineOperation(current, operation), revision: 2 };
    mutate.mockRejectedValue(new BoardOperationError('The saved operation needs review.'));
    online = true;
    await open().loadBoardList();
    expect(mutate).toHaveBeenCalledWith(
      original.id,
      operation,
      pending[0]!.id,
      pending[0]!.baseRevision,
      expect.objectContaining({ revision: original.revision }),
    );
    expect((await database.read(original.id))?.pending).toEqual(pending);
  });
  it('keeps a rejected board ordered while uploading other boards and reporting its error only there', async () => {
    const other = {
      ...original,
      id: '33333333-3333-4333-8333-333333333333',
      invite_code: 'b'.repeat(32),
    };
    const remoteBoards = new Map([
      [original.id, structuredClone(original)],
      [other.id, other],
    ]);
    const send = vi.fn(async (id: string, operation: Operation) => {
      if (id === original.id) throw new BoardOperationError('That card was removed.');
      const { localPending: _pending, ...saved } = applyOfflineOperation(
        remoteBoards.get(id)!,
        operation,
      );
      const next = { ...saved, revision: remoteBoards.get(id)!.revision + 1 };
      remoteBoards.set(id, next);
      return next;
    });
    const cloud = withOfflineBoards(
      {
        ...recoveryRemote,
        loadBoardList: async () => [...remoteBoards.values()].map(summarizeBoard),
        loadBoard: async (id) => remoteBoards.get(id)!,
        createBoard: async () => original,
        joinBoard: async () => original,
        mutateBoard: send,
      },
      database,
    );
    await cloud.loadBoard(original.id);
    await cloud.loadBoard(other.id);
    online = false;
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Blocked title' },
    });
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { description: 'Must stay second' },
    });
    await cloud.mutateBoard(other.id, { type: 'update_board', patch: { title: 'Uploaded title' } });
    online = true;
    const summaries = await cloud.loadBoardList();
    expect(summaries.find((row) => row.id === original.id)).toMatchObject({
      title: 'Blocked title',
      localPending: true,
      localError: 'That card was removed.',
    });
    expect(summaries.find((row) => row.id === other.id)).toMatchObject({ title: 'Uploaded title' });
    expect(summaries.find((row) => row.id === other.id)).not.toHaveProperty('localError');
    expect(send.mock.calls.map(([id]) => id)).toEqual([original.id, other.id]);
    expect((await database.read(original.id))?.pending).toHaveLength(2);
    expect((await database.read(other.id))?.pending).toEqual([]);
  });
  it('stops a pass on a global setup error and retains every queued operation', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    online = false;
    await cloud.mutateBoard(original.id, { type: 'update_board', patch: { title: 'Keep first' } });
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { description: 'Keep second' },
    });
    online = true;
    mutate.mockRejectedValueOnce(new BoardSyncUnavailableError('Database setup required.'));
    expect((await cloud.loadBoardList())[0]).toMatchObject({
      localError: 'Database setup required.',
      localPending: true,
    });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect((await database.read(original.id))?.pending).toHaveLength(2);
  });
  it('reuses a durable server operation ID after a lost reply without overwriting a later edit', async () => {
    const cloud = open();
    await cloud.loadBoard(original.id);
    let accepted: string | undefined;
    const send = vi.fn(async (_id: string, operation: Operation, token?: string) => {
      if (token === accepted) return current;
      accepted = token;
      const { localPending: _pending, ...saved } = applyOfflineOperation(current, operation);
      current = { ...saved, revision: 2 };
      throw new Error('Network response lost');
    });
    mutate.mockImplementation(send);
    await cloud.mutateBoard(original.id, {
      type: 'update_board',
      patch: { title: 'Earlier edit' },
    });
    const pending = (await database.read(original.id))!.pending[0]!;
    current = { ...current, title: 'Later remote edit', revision: 3 };
    await open().loadBoardList();
    expect(current.title).toBe('Later remote edit');
    expect(mutate).toHaveBeenNthCalledWith(
      1,
      original.id,
      pending.operation,
      pending.id,
      1,
      original,
    );
    expect(mutate).toHaveBeenNthCalledWith(
      2,
      original.id,
      pending.operation,
      pending.id,
      1,
      original,
    );
    expect(await database.all(true)).toEqual([]);
  });
});

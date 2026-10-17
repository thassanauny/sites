import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Board, Card } from '../../domain/boards/types';

const mock = vi.hoisted(() => {
  const getSession = vi.fn();
  const signInAnonymously = vi.fn();
  const orderIds = vi.fn();
  const inIds = vi.fn(() => ({ order: orderIds }));
  const select = vi.fn((_columns: string, _options?: { count?: string }) => ({ in: inIds }));
  const from = vi.fn((_table: string) => ({ select }));
  const rpc = vi.fn();
  const client = { auth: { getSession, signInAnonymously }, from, rpc };
  return {
    getSession,
    signInAnonymously,
    orderIds,
    inIds,
    select,
    from,
    rpc,
    createClient: vi.fn(() => client),
    navigatorLock: vi.fn(),
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: mock.createClient,
  navigatorLock: mock.navigatorLock,
}));

const card: Card = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Book the room',
  description: '',
  columnId: 'todo',
  position: 1_024,
  priority: 'medium',
  assignee: '',
  dueDate: '',
  labels: [],
};
const board: Board = {
  id: '22222222-2222-4222-8222-222222222222',
  invite_code: 'a'.repeat(32),
  title: 'Trip plans',
  description: '',
  columns: [{ id: 'todo', title: 'To do', color: 'slate' }],
  cards: [card],
  revision: 1,
  created_at: '2026-10-10T01:00:00.123456+00:00',
  updated_at: '2026-10-10T01:00:00.123456+00:00',
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://test-project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'public-test-key');
  vi.stubGlobal('navigator', { onLine: true });
  mock.getSession.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });
  mock.signInAnonymously.mockResolvedValue({
    data: { session: { access_token: 'test-token' } },
    error: null,
  });
  mock.rpc.mockImplementation(async (name: string) => ({
    data: name === 'pinboard_sync_summaries' ? { format: 1, heads: [], boards: [] } : board,
    error: null,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('online board sharing', () => {
  it('loads a compact collection in one request and fetches one board only when requested', async () => {
    const { summarizeBoard } = await import('../../domain/boards/summary');
    const summary = summarizeBoard(board);
    mock.rpc.mockResolvedValueOnce({
      data: { format: 1, heads: [{ id: board.id, revision: board.revision }], boards: [summary] },
      error: null,
    });
    mock.rpc.mockResolvedValueOnce({
      data: { format: 1, heads: [{ id: board.id, revision: board.revision }], boards: [] },
      error: null,
    });
    mock.orderIds.mockResolvedValueOnce({ data: [board], error: null });
    const cloud = await import('./boards');
    expect(await cloud.loadBoardList()).toEqual([summary]);
    expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('pinboard_sync_summaries', { p_known: {} });
    expect(mock.from).not.toHaveBeenCalled();
    expect((await cloud.loadBoardList([summary]))[0]).toBe(summary);
    expect(mock.rpc).toHaveBeenLastCalledWith('pinboard_sync_summaries', {
      p_known: { [board.id]: board.revision },
    });
    expect(mock.orderIds).not.toHaveBeenCalled();
    expect(await cloud.loadBoard(board.id)).toEqual(board);
    expect(mock.inIds).toHaveBeenCalledExactlyOnceWith('id', [board.id]);
  });

  it.each(['PGRST202', '42883'])(
    'reports missing summary setup without full-board reads (%s)',
    async (code) => {
      mock.rpc.mockResolvedValueOnce({
        data: null,
        error: { code, message: 'function not found' },
      });
      const cloud = await import('./boards');
      await expect(cloud.loadBoardList()).rejects.toThrow('database setup');
      expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('pinboard_sync_summaries', { p_known: {} });
      expect(mock.from).not.toHaveBeenCalled();
    },
  );
  it('rejects missing summary revisions and access errors without falling back to larger reads', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: { format: 1, heads: [{ id: board.id, revision: 2 }], boards: [] },
      error: null,
    });
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'permission denied' },
    });
    const cloud = await import('./boards');
    await expect(cloud.loadBoardList()).rejects.toThrow('list changed');
    await expect(cloud.loadBoardList()).rejects.toThrow('permission denied');
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('reports absent configuration without starting a session', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', '');
    vi.stubEnv('VITE_SUPABASE_ANON_KEY', '');
    const cloud = await import('./boards');
    expect(cloud.cloudConfigured).toBe(false);
    await expect(cloud.initializeCloud()).rejects.toThrow('not configured');
    expect(mock.createClient).not.toHaveBeenCalled();
  });

  it('shares simultaneous session checks and uses storage separate from IOU', async () => {
    const cloud = await import('./boards');
    await Promise.all([cloud.initializeCloud(), cloud.initializeCloud(), cloud.initializeCloud()]);
    expect(mock.getSession).toHaveBeenCalledTimes(1);
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(mock.createClient).toHaveBeenCalledWith(
      'https://test-project.supabase.co',
      'public-test-key',
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: 'pinboard-auth',
        },
        global: { fetch: expect.any(Function) },
      },
    );
  });

  it('creates an anonymous identity only when the stored session is missing', async () => {
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const cloud = await import('./boards');
    await Promise.all([cloud.initializeCloud(), cloud.initializeCloud()]);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('rechecks the identity on later actions and can restore a lost session', async () => {
    const cloud = await import('./boards');
    await cloud.initializeCloud();
    mock.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    await cloud.loadBoardList();
    expect(mock.getSession).toHaveBeenCalledTimes(2);
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('allows authentication to retry after a failed connection', async () => {
    mock.getSession.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const cloud = await import('./boards');
    await expect(cloud.initializeCloud()).rejects.toThrow('Check your connection');
    await expect(cloud.initializeCloud()).resolves.toBeUndefined();
    expect(mock.getSession).toHaveBeenCalledTimes(2);
  });

  it('keeps session-restoration errors from creating a replacement identity and allows retry', async () => {
    mock.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Failed to fetch' },
    });
    const cloud = await import('./boards');
    await expect(cloud.initializeCloud()).rejects.toThrow('Check your connection');
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    await expect(cloud.initializeCloud()).resolves.toBeUndefined();
    expect(mock.getSession).toHaveBeenCalledTimes(2);
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
  });

  it('does not sign in or send a board request if connectivity drops while checking a missing session', async () => {
    mock.getSession.mockImplementationOnce(async () => {
      vi.stubGlobal('navigator', { onLine: false });
      return { data: { session: null }, error: null };
    });
    const cloud = await import('./boards');
    await expect(cloud.loadBoardList()).rejects.toThrow('offline');
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(mock.from).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', { onLine: true });
    await expect(cloud.loadBoardList()).resolves.toEqual([]);
  });

  it('retries an unsuccessful anonymous sign-in instead of retaining a failed initialization', async () => {
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    mock.signInAnonymously.mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Failed to fetch' },
    });
    const cloud = await import('./boards');
    await expect(cloud.initializeCloud()).rejects.toThrow('Check your connection');
    await expect(cloud.initializeCloud()).resolves.toBeUndefined();
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(2);
  });

  it('moves the stored identity before creating the Supabase client without writing board data', async () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      locks: {
        request: vi.fn(async (_name: string, _options: unknown, callback: () => unknown) =>
          callback(),
        ),
      },
    });
    const session = JSON.stringify({
      access_token: 'previous-token',
      refresh_token: 'previous-refresh',
      expires_at: 4_000_000_000,
    });
    const values = new Map([['kanban-auth', session]]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });
    mock.createClient.mockImplementationOnce(() => {
      expect(values.get('pinboard-auth')).toBe(session);
      expect(values.get('kanban-auth')).toBe(session);
      return {
        auth: {
          getSession: mock.getSession,
          signInAnonymously: mock.signInAnonymously,
        },
        from: mock.from,
        rpc: mock.rpc,
      };
    });
    const cloud = await import('./boards');
    await expect(cloud.loadBoardList()).resolves.toEqual([]);
    expect(storage.setItem.mock.calls).toEqual([['pinboard-auth', session]]);
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
  });

  it('explicitly coordinates ordinary auth writers with the migration Web Lock', async () => {
    vi.stubGlobal('navigator', { onLine: true, locks: { request: vi.fn() } });
    const cloud = await import('./boards');
    await cloud.initializeCloud();
    expect(mock.createClient).toHaveBeenCalledWith(
      'https://test-project.supabase.co',
      'public-test-key',
      expect.objectContaining({
        auth: expect.objectContaining({ lock: mock.navigatorLock }),
      }),
    );
  });

  it('does not replace an identity when browser storage is unavailable and retries once storage returns', async () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    let blocked = true;
    vi.stubGlobal('window', {
      get localStorage() {
        if (blocked) throw new Error('Storage disabled');
        return storage;
      },
    });
    const cloud = await import('./boards');
    await expect(cloud.initializeCloud()).rejects.toThrow('saved board session');
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    blocked = false;
    await expect(cloud.initializeCloud()).resolves.toBeUndefined();
    expect(mock.createClient).toHaveBeenCalledTimes(1);
  });

  it('retains malformed migrated credentials without initializing or replacing the identity', async () => {
    const raw = JSON.stringify({
      access_token: 'old-token',
      refresh_token: 'old-refresh',
    });
    const values = new Map([['kanban-auth', raw]]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    const cloud = await import('./boards');
    await expect(cloud.initializeCloud()).rejects.toThrow('original credentials are preserved');
    expect(values.get('kanban-auth')).toBe(raw);
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('repeats the session recovery on every later call while the stored session stays malformed', async () => {
    const raw = '{}';
    const values = new Map([['pinboard-auth', raw]]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    const cloud = await import('./boards');
    await expect(cloud.loadBoardList()).rejects.toThrow('original credentials are preserved');
    await expect(cloud.loadBoardList()).rejects.toThrow('original credentials are preserved');
    expect(storage.getItem).toHaveBeenCalledTimes(2);
    expect(values.get('pinboard-auth')).toBe(raw);
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.signInAnonymously).not.toHaveBeenCalled();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  it('refuses offline reads and writes without creating a queue or contacting Supabase', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const cloud = await import('./boards');
    await expect(cloud.loadBoardList()).rejects.toThrow('offline');
    await expect(cloud.createBoard(board.id, board.title, '')).rejects.toThrow('offline');
    await expect(cloud.joinBoard(board.invite_code)).rejects.toThrow('offline');
    await expect(cloud.mutateBoard(board.id, { type: 'delete_card', id: card.id })).rejects.toThrow(
      'offline',
    );
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('does not send a write if the browser becomes offline during session initialization', async () => {
    mock.getSession.mockImplementationOnce(async () => {
      vi.stubGlobal('navigator', { onLine: false });
      return { data: { session: {} }, error: null };
    });
    const cloud = await import('./boards');
    await expect(
      cloud.mutateBoard(board.id, {
        type: 'update_board',
        patch: { title: 'New' },
      }),
    ).rejects.toThrow('offline');
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('reports missing current board columns without retrying an obsolete selection', async () => {
    mock.orderIds.mockResolvedValueOnce({
      data: null,
      error: { code: '42703', message: 'column card_fields does not exist' },
    });
    const cloud = await import('./boards');
    await expect(cloud.loadBoard(board.id)).rejects.toThrow('database setup');
    expect(mock.orderIds).toHaveBeenCalledTimes(1);
    expect(mock.select).toHaveBeenCalledExactlyOnceWith(
      'id,invite_code,title,description,columns,cards,revision,created_at,updated_at,card_fields',
    );
  });

  it('reports invalid operations and removed assignments with useful messages', async () => {
    const cloud = await import('./boards');
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: '22023', message: 'PINBOARD_INVALID_OPERATION' },
    });
    await expect(
      cloud.mutateBoard(board.id, { type: 'add_assignee', name: 'Sam' }),
    ).rejects.toThrow('invalid data');
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'P0001', message: 'PINBOARD_ASSIGNEE_NOT_FOUND' },
    });
    await expect(
      cloud.mutateBoard(board.id, {
        type: 'update_card',
        id: '11111111-1111-4111-8111-111111111111',
        patch: { assignee: 'Sam' },
      }),
    ).rejects.toThrow('Choose another name or Unassigned');
  });

  it('rejects missing, repeated or unrequested detail rows instead of opening another board', async () => {
    const cloud = await import('./boards');
    for (const data of [
      null,
      [],
      [board, board],
      [{ ...board, id: '33333333-3333-4333-8333-333333333333' }],
    ]) {
      mock.orderIds.mockResolvedValueOnce({ data, error: null });
      await expect(cloud.loadBoard(board.id)).rejects.toThrow('board list changed while loading');
    }
    mock.orderIds.mockResolvedValueOnce({
      data: [{ ...board, cards: [{ ...card, dueDate: '2026-02-30' }] }],
      error: null,
    });
    await expect(cloud.loadBoard(board.id)).rejects.toThrow('invalid board data');
    mock.orderIds.mockResolvedValueOnce({ data: null, error: { message: 'Failed to fetch' } });
    await expect(cloud.loadBoard(board.id)).rejects.toThrow('Check your connection');
  });

  it('requires complete and unique summary heads and valid revisions', async () => {
    const cloud = await import('./boards');
    const { summarizeBoard } = await import('../../domain/boards/summary');
    const summary = summarizeBoard(board);
    for (const data of [
      null,
      { format: 1, heads: [], boards: null },
      { format: 1, heads: [{ id: board.id, revision: 0 }], boards: [summary] },
      { format: 1, heads: [{ id: 'bad', revision: 1 }], boards: [summary] },
      {
        format: 1,
        heads: [
          { id: board.id, revision: 1 },
          { id: board.id, revision: 1 },
        ],
        boards: [summary],
      },
      { format: 1, heads: [], boards: [summary] },
      { format: 1, heads: [{ id: board.id, revision: 1 }], boards: [summary, summary] },
    ]) {
      mock.rpc.mockResolvedValueOnce({ data, error: null });
      await expect(cloud.loadBoardList()).rejects.toThrow();
    }
    expect(mock.from).not.toHaveBeenCalled();
  });

  it('ignores fields a newer server adds to a board result', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: { ...board, archived_at: null, future: { flag: true } },
      error: null,
    });
    const cloud = await import('./boards');
    await expect(cloud.joinBoard(board.invite_code)).resolves.toEqual(board);
  });

  describe('request time limit', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    async function limitedFetch() {
      const cloud = await import('./boards');
      await cloud.initializeCloud();
      return (
        mock.createClient.mock.calls[0] as unknown as [
          string,
          string,
          { global: { fetch: typeof fetch } },
        ]
      )[2].global.fetch;
    }
    // Like a real fetch: rejects with the signal's reason when aborted, even before it starts.
    const hang = () =>
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            if (init?.signal?.aborted) reject(init.signal.reason);
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
          }),
      );

    it('ends a request that never completes after 30 seconds', async () => {
      const fetcher = hang();
      vi.stubGlobal('fetch', fetcher);
      const send = await limitedFetch();
      const outcome = send('https://test-project.supabase.co/rest/v1/pinboard_boards').then(
        () => 'finished',
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      await expect(Promise.race([outcome, Promise.resolve('waiting')])).resolves.toBe('waiting');
      await vi.advanceTimersByTimeAsync(1);
      await expect(outcome).resolves.toBe('The request took too long.');
    });

    it('also ends a request when the caller aborts it, and passes ordinary responses through', async () => {
      const fetcher = hang();
      vi.stubGlobal('fetch', fetcher);
      const send = await limitedFetch();
      const caller = new AbortController();
      const outcome = send('https://test-project.supabase.co/auth/v1/token', {
        signal: caller.signal,
      }).then(
        () => 'finished',
        (error: Error) => error.message,
      );
      caller.abort(new Error('Caller gave up'));
      await expect(outcome).resolves.toBe('Caller gave up');
      const done = new Response('{}');
      fetcher.mockImplementationOnce(() => Promise.resolve(done));
      await expect(send('https://test-project.supabase.co/rest/v1/x')).resolves.toBe(done);
      const already = new AbortController();
      already.abort(new Error('Already aborted'));
      await expect(
        send('https://test-project.supabase.co/rest/v1/x', {
          signal: already.signal,
        }),
      ).rejects.toThrow('Already aborted');
    });

    it('explains a timed-out request in plain words', async () => {
      const cloud = await import('./boards');
      mock.rpc.mockResolvedValueOnce({
        data: null,
        count: null,
        error: { message: 'TimeoutError: The request took too long.' },
      });
      await expect(cloud.loadBoardList()).rejects.toThrow(
        'The request took too long. Check your connection',
      );
      mock.rpc.mockResolvedValueOnce({
        data: null,
        error: {
          message: 'canceling statement due to statement timeout',
          code: '57014',
        },
      });
      await expect(
        cloud.mutateBoard(board.id, { type: 'delete_card', id: card.id }),
      ).rejects.toThrow('The request took too long.');
    });
  });

  it('uses the server-generated invitation and reuses the stable ID after a lost create response', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'Failed to fetch' },
    });
    const created = { ...board, invite_code: 'b'.repeat(32) };
    mock.rpc.mockResolvedValueOnce({ data: created, error: null });
    const cloud = await import('./boards');
    await expect(cloud.createBoard(board.id, board.title, '')).rejects.toThrow(
      'Check your connection',
    );
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    await expect(cloud.createBoard(board.id, board.title, '')).resolves.toEqual(created);
    expect(mock.rpc.mock.calls).toEqual([
      ['pinboard_create_board', { p_id: board.id, p_title: board.title, p_description: '' }],
      ['pinboard_create_board', { p_id: board.id, p_title: board.title, p_description: '' }],
    ]);
  });

  it('normalizes complete invite codes before joining', async () => {
    const cloud = await import('./boards');
    await expect(cloud.joinBoard(` ${'A'.repeat(16)}\n${'A'.repeat(16)} `)).resolves.toEqual(board);
    expect(mock.rpc).toHaveBeenCalledWith('pinboard_join_board', {
      p_code: board.invite_code,
    });
  });

  it('rejects malformed fields locally before authentication or writes', async () => {
    const cloud = await import('./boards');
    await expect(cloud.joinBoard('abcd')).rejects.toThrow('32-character');
    await expect(cloud.createBoard('bad-id', 'Title', '')).rejects.toThrow('ID');
    await expect(cloud.createBoard(board.id, ' ', '')).rejects.toThrow('required');
    await expect(
      cloud.mutateBoard(board.id, {
        type: 'move_card',
        id: card.id,
        columnId: 'todo',
        position: Infinity,
      }),
    ).rejects.toThrow('position');
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
  });

  it('sends one field-level operation without an expected revision or full board replacement', async () => {
    const cloud = await import('./boards');
    const operation = {
      type: 'update_card' as const,
      id: card.id,
      patch: { title: 'Booked' },
    };
    await expect(cloud.mutateBoard(board.id, operation)).resolves.toEqual(board);
    expect(mock.rpc).toHaveBeenCalledWith('pinboard_mutate_board', {
      p_board_id: board.id,
      p_operation: operation,
    });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('sends only column IDs and accepts the server’s current order, metadata, and cards', async () => {
    const done = {
      id: 'done',
      title: 'Finished together',
      color: 'emerald' as const,
    };
    const incoming = {
      ...board,
      columns: [done, { ...board.columns[0]!, title: 'Ready next' }],
      revision: 2,
    };
    mock.rpc.mockResolvedValueOnce({ data: incoming, error: null });
    const cloud = await import('./boards');
    const columnIds = ['done', 'todo'];
    const result = await cloud.mutateBoard(board.id, {
      type: 'reorder_columns',
      columnIds,
    });
    expect(mock.rpc).toHaveBeenCalledWith('pinboard_mutate_board', {
      p_board_id: board.id,
      p_operation: { type: 'reorder_columns', columnIds: ['done', 'todo'] },
    });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(result).toEqual(incoming);
    expect(result.columns.map((column) => column.id)).toEqual(['done', 'todo']);
    expect(result.cards).toEqual(board.cards);
    expect(mock.rpc.mock.calls[0]![1].p_operation.columnIds).not.toBe(columnIds);
  });

  it('rejects an invalid column order before authentication and explains server validation failures', async () => {
    const cloud = await import('./boards');
    await expect(
      cloud.mutateBoard(board.id, {
        type: 'reorder_columns',
        columnIds: ['todo', 'todo'],
      }),
    ).rejects.toThrow('unique');
    expect(mock.getSession).not.toHaveBeenCalled();
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PINBOARD_INVALID_OPERATION' },
    });
    await expect(
      cloud.mutateBoard(board.id, {
        type: 'reorder_columns',
        columnIds: ['todo'],
      }),
    ).rejects.toThrow('invalid data');
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });

  it('rejects mismatched RPC records instead of opening a different board', async () => {
    mock.rpc.mockResolvedValueOnce({
      data: { ...board, id: '33333333-3333-4333-8333-333333333333' },
      error: null,
    });
    mock.rpc.mockResolvedValueOnce({
      data: { ...board, invite_code: 'b'.repeat(32) },
      error: null,
    });
    const cloud = await import('./boards');
    await expect(cloud.mutateBoard(board.id, { type: 'delete_card', id: card.id })).rejects.toThrow(
      'different board',
    );
    await expect(cloud.joinBoard(board.invite_code)).rejects.toThrow('different invitation');
  });

  it('explains missing schema, disabled anonymous auth, and removed-card errors honestly', async () => {
    const cloud = await import('./boards');
    mock.rpc.mockResolvedValueOnce({
      data: null,
      count: null,
      error: {
        code: 'PGRST205',
        message: 'Could not find the table public.pinboard_boards in the schema cache',
      },
    });
    await expect(cloud.loadBoardList()).rejects.toThrow('apps/pinboard/supabase/README.md');
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST202', message: 'missing function' },
    });
    const setup = await cloud.createBoard(board.id, board.title, '').catch((error: Error) => error);
    expect((setup as Error).message).toContain('database setup');
    expect((setup as Error).message).not.toMatch(/upgrade/i);
    mock.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });
    mock.signInAnonymously.mockResolvedValueOnce({
      data: { session: null },
      error: {
        code: 'anonymous_provider_disabled',
        message: 'Anonymous sign-ins are disabled',
      },
    });
    await expect(cloud.initializeCloud()).rejects.toThrow('Enable anonymous sign-ins');
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PINBOARD_CARD_NOT_FOUND' },
    });
    await expect(cloud.mutateBoard(board.id, { type: 'delete_card', id: card.id })).rejects.toThrow(
      'card was removed',
    );
    mock.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'PINBOARD_BOARD_TOO_LARGE' },
    });
    await expect(cloud.mutateBoard(board.id, { type: 'delete_card', id: card.id })).rejects.toThrow(
      'This board is full',
    );
  });

  it('starts a new session by backing up the damaged value, after which the app signs in again', async () => {
    vi.stubGlobal('navigator', { onLine: true });
    const values = new Map([['pinboard-auth', '{}']]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key);
      }),
    };
    vi.stubGlobal('window', { localStorage: storage });
    mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    const cloud = await import('./boards');
    await expect(cloud.initializeCloud()).rejects.toMatchObject({ problem: 'corrupt' });
    expect(mock.createClient).not.toHaveBeenCalled();
    await cloud.startNewSession();
    expect(values.has('pinboard-auth')).toBe(false);
    expect([...values.values()]).toEqual(['{}']);
    await expect(cloud.initializeCloud()).resolves.toBeUndefined();
    expect(mock.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('reports a storage failure while starting a new session without removing anything', async () => {
    const values = new Map([['pinboard-auth', '{}']]);
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn(() => {
        throw new Error('Quota exceeded');
      }),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    const cloud = await import('./boards');
    await expect(cloud.startNewSession()).rejects.toThrow('saved board session');
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(values.get('pinboard-auth')).toBe('{}');
  });
});

import type { Board, BoardSummary, Operation } from '../../domain/boards/types';
import { summarizeBoard } from '../../domain/boards/summary';
import { applyOfflineOperation } from '../../domain/boards/offline';
import { AUTH_STORAGE_KEY, migratePinboardSession } from '../auth/migrateSession';
import { OfflineDatabase } from '../storage/offlineDatabase';

export interface Entry {
  draft?: Board;
  summary: BoardSummary;
  board?: Board;
  pending: { id: string; operation: Operation }[];
}
interface Remote {
  loadBoardList(known?: readonly BoardSummary[]): Promise<BoardSummary[]>;
  loadBoard(id: string): Promise<Board>;
  createBoard(id: string, title: string, description: string): Promise<Board>;
  joinBoard(code: string): Promise<Board>;
  mutateBoard(id: string, operation: Operation): Promise<Board>;
}
async function owner(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  await migratePinboardSession(window.localStorage);
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  return raw ? (JSON.parse(raw).user?.id ?? null) : null;
}
const transient = (error: unknown) =>
  /network|connection|connect|fetch|offline|timed? ?out|took too long|abort/i.test(
    error instanceof Error ? error.message : '',
  );
const project = (entry: Entry): Board | undefined => {
  try {
    return entry.pending.reduce<Board | undefined>(
      (board, change) => board && applyOfflineOperation(board, change.operation),
      entry.board,
    );
  } catch (error) {
    if (!entry.draft) throw error;
    return {
      ...entry.draft,
      localPending: true,
      localError: error instanceof Error ? error.message : 'Pending changes need attention.',
    };
  }
};

/** Persist operations before acknowledging a save; tabs upload one queue at a time. */
export function withOfflineBoards(
  remote: Remote,
  database = new OfflineDatabase<Entry>('pinboard-offline-v1', owner),
): Remote {
  let syncing: Promise<void> | undefined;
  let syncError = '';
  async function remember(board: Board): Promise<Board> {
    if (!(await database.owner())) return board;
    const entry = await database.change(board.id, (current) => ({
      value: {
        board: current?.board && current.board.revision > board.revision ? current.board : board,
        summary: summarizeBoard(board),
        pending: current?.pending ?? [],
        draft: current?.draft,
      },
      queued: Boolean(current?.pending.length),
    }));
    return project(entry)!;
  }
  async function sync(): Promise<void> {
    if (!navigator.onLine) return;
    if (syncing) return syncing;
    const identity = await database.owner();
    if (!identity) return;
    if (!navigator.locks)
      throw new Error(
        'Automatic sync needs browser Web Locks. Pending edits are kept on this device.',
      );
    syncing = navigator.locks
      .request(`pinboard-offline-sync:${identity}`, async () => {
        for (const entry of await database.all(true)) {
          let current = await database.read(entry.summary.id);
          while (current?.pending.length && navigator.onLine) {
            if ((await database.owner()) !== identity) return;
            const sent = current.pending[0]!;
            // Deleting a column may have succeeded before a response was lost.
            const latest =
              sent.operation.type === 'delete_column'
                ? await remote.loadBoard(entry.summary.id)
                : undefined;
            const saved =
              latest &&
              !latest.columns.some((column) => column.id === (sent.operation as { id: string }).id)
                ? latest
                : await remote.mutateBoard(entry.summary.id, sent.operation);
            if ((await database.owner()) !== identity) return;
            current = await database.change(
              saved.id,
              (value) => {
                const pending = (value?.pending ?? []).filter((change) => change.id !== sent.id);
                return {
                  value: {
                    board: saved,
                    summary: summarizeBoard(saved),
                    pending,
                    ...(pending.length ? { draft: value?.draft } : {}),
                  },
                  queued: pending.length > 0,
                };
              },
              identity,
            );
          }
        }
      })
      .finally(() => {
        syncing = undefined;
      });
    return syncing;
  }
  return {
    loadBoardList: async (known) => {
      if (!(await database.owner())) return remote.loadBoardList(known);
      if (navigator.onLine) {
        try {
          await sync();
          syncError = '';
          const summaries = await remote.loadBoardList(
            (known ?? [])
              .filter((board) => !board.localPending)
              .map(
                ({
                  localCached: _cached,
                  localError: _error,
                  localPending: _pending,
                  ...summary
                }) => summary,
              ),
          );
          if (!(await database.owner())) return summaries;
          for (const summary of summaries)
            await database.change(summary.id, (entry) => ({
              value: { ...entry, summary, pending: entry?.pending ?? [] },
              queued: Boolean(entry?.pending.length),
            }));
          return Promise.all(
            summaries.map(async (summary) => {
              const entry = await database.read(summary.id);
              const board = entry?.pending.length ? project(entry) : undefined;
              return board ? summarizeBoard(board) : summary;
            }),
          );
        } catch (error) {
          if (!(await database.all()).length) throw error;
          syncError = error instanceof Error ? error.message : 'Could not sync your boards.';
        }
      }
      return (await database.all()).map((entry) => {
        const board = project(entry);
        return {
          ...(board ? summarizeBoard(board) : entry.summary),
          localCached: true,
          ...(syncError ? { localError: syncError } : {}),
        };
      });
    },
    loadBoard: async (id) => {
      if (!(await database.owner())) return remote.loadBoard(id);
      if (navigator.onLine) {
        try {
          await sync();
          syncError = '';
          return await remember(await remote.loadBoard(id));
        } catch (error) {
          if (!(await database.read(id))?.board) throw error;
          syncError = error instanceof Error ? error.message : 'Could not sync your board.';
        }
      }
      const entry = await database.read(id);
      const board = entry && project(entry);
      if (!board) throw new Error('Open this board online once before using it offline.');
      return { ...board, localCached: true, ...(syncError ? { localError: syncError } : {}) };
    },
    createBoard: async (id, title, description) =>
      remember(await remote.createBoard(id, title, description)),
    joinBoard: async (code) => remember(await remote.joinBoard(code)),
    mutateBoard: async (id, operation) => {
      const cached = await database.read(id);
      if (!cached?.board) {
        if (!navigator.onLine)
          throw new Error(
            'You are offline. Open this board online once before editing it offline.',
          );
        return remember(await remote.mutateBoard(id, operation));
      }
      const token = crypto.randomUUID();
      const entry = await database.change(id, (current) => {
        if (!current?.board) throw new Error('The saved board is unavailable. Your draft is kept.');
        const draft = applyOfflineOperation(project(current)!, operation);
        return {
          value: {
            ...current,
            draft,
            pending: [...current.pending, { id: token, operation: structuredClone(operation) }],
          },
          queued: true,
        };
      });
      if (navigator.onLine) {
        try {
          await sync();
        } catch (error) {
          if (!transient(error)) throw error;
        }
      }
      return project((await database.read(id)) ?? entry)!;
    },
  };
}

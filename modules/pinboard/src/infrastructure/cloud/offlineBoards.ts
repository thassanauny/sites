import type { Board, BoardSummary, Operation } from '../../domain/boards/types';
import { summarizeBoard } from '../../domain/boards/summary';
import { applyOfflineOperation } from '../../domain/boards/offline';
import {
  normalizeInviteCode,
  validateBoardDetails,
  validateOperation,
  validateUuid,
} from '../../domain/boards/board';
import { AUTH_STORAGE_KEY, migratePinboardSession } from '../auth/migrateSession';
import { OfflineDatabase } from '../storage/offlineDatabase';

export interface Entry {
  draft?: Board;
  summary: BoardSummary;
  board?: Board;
  pending: { id: string; operation: Operation; baseRevision?: number }[];
  backups?: { id: string; board: Board; createdAt: string }[];
  /** A local editor save rejected before queueing; its durable backup is never uploaded. */
  unappliedBackupId?: string;
}
export interface PendingBoardReview {
  owner: string;
  shared: Board;
  local: Board;
  pendingIds: string[];
  backups: NonNullable<Entry['backups']>;
  online: boolean;
  unappliedBackupId?: string;
  retryError?: string;
}
interface Remote {
  /** Establish a first anonymous session before capturing ownership of data requests. */
  initialize?(): Promise<void>;
  loadBoardList(known?: readonly BoardSummary[]): Promise<BoardSummary[]>;
  loadBoard(id: string): Promise<Board>;
  createBoard(id: string, title: string, description: string): Promise<Board>;
  joinBoard(code: string): Promise<Board>;
  mutateBoard(
    id: string,
    operation: Operation,
    operationId?: string,
    baseRevision?: number,
  ): Promise<Board>;
}
interface OfflineBoards extends Omit<Remote, 'mutateBoard'> {
  mutateBoard(id: string, operation: Operation, recovery?: Board): Promise<Board>;
  reviewPendingBoard(id: string): Promise<PendingBoardReview>;
  resolvePendingBoard(review: PendingBoardReview, action: 'retry' | 'discard'): Promise<Board>;
}
/** Setup/authentication failures affect every board and must stop the upload pass. */
export class BoardSyncUnavailableError extends Error {}
/** A rejected operation blocks its board, while other boards can still upload. */
export class BoardOperationError extends Error {}
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
const unappliedMessage =
  'That card was removed. Your draft is backed up on this device. Open Review device edits to download it or use the shared board.';
function missingCard(board: Board, operation: Operation): boolean {
  return (
    (operation.type === 'update_card' || operation.type === 'move_card') &&
    !board.cards.some((card) => card.id === operation.id)
  );
}
function reviewRetryError(entry: Entry, shared: Board): string | undefined {
  const removed =
    'A card in this draft was removed. Download the draft or choose Use shared board; retrying cannot restore deleted cards.';
  if (entry.unappliedBackupId) return removed;
  const cards = new Set(shared.cards.map((card) => card.id));
  let unconfirmedCreate = false;
  for (const { operation } of entry.pending) {
    if (operation.type === 'create_card') {
      if (!cards.has(operation.card.id)) unconfirmedCreate = true;
      cards.add(operation.card.id);
    } else if (operation.type === 'delete_card') {
      cards.delete(operation.id);
    } else if (
      (operation.type === 'update_card' || operation.type === 'move_card') &&
      !cards.has(operation.id)
    ) {
      return removed;
    }
  }
  // A missing queued creation may be new, or accepted before a lost reply and
  // later deleted. Original IDs/bases stay safe for automatic sync; replacing
  // them after receipt expiry could recreate work another member deleted.
  return unconfirmedCreate
    ? 'A new card in this draft is not on the shared board. It may not have synced, or may have been removed after syncing. Download the draft or choose Use shared board; this review cannot safely recreate it.'
    : undefined;
}
function recoveryBoard(entry: Entry): Board | undefined {
  return entry.backups?.find((backup) => backup.id === entry.unappliedBackupId)?.board;
}
/** Keep exact editor values in local recovery; they never replace the wire operation. */
function editorSnapshot(source: Board, recovery: Board | undefined, operation: Operation): Board {
  if (
    !recovery ||
    recovery.id !== source.id ||
    (operation.type !== 'update_card' && operation.type !== 'move_card')
  )
    return source;
  const card = recovery.cards.find((card) => card.id === operation.id);
  if (!card) throw new Error('The editor recovery copy is unavailable. Keep this draft open.');
  const { localPending: _pending, localCached: _cached, localError: _error, ...base } = source;
  return {
    ...base,
    cards: base.cards.some((item) => item.id === card.id)
      ? base.cards.map((item) => (item.id === card.id ? structuredClone(card) : item))
      : [...base.cards, structuredClone(card)],
    columns: [
      ...base.columns,
      ...recovery.columns.filter(
        (column) =>
          column.id === card.columnId && !base.columns.some((current) => current.id === column.id),
      ),
    ],
  };
}
const project = (entry: Entry): Board | undefined => {
  try {
    const board = entry.pending.reduce<Board | undefined>(
      (board, change) => board && applyOfflineOperation(board, change.operation),
      entry.board,
    );
    return board && entry.unappliedBackupId ? { ...board, localError: unappliedMessage } : board;
  } catch (error) {
    if (!entry.draft) throw error;
    return {
      ...entry.draft,
      localPending: true,
      localError: error instanceof Error ? error.message : 'Pending changes need attention.',
    };
  }
};
function reviewDraft(entry: Entry, shared?: Board): Board | undefined {
  const local =
    (shared && reviewRetryError(entry, shared) ? entry.draft : undefined) ?? project(entry);
  const recovery = recoveryBoard(entry);
  if (!local || !recovery) return local;
  // Carry only missing recovery cards over the current projection, so newer
  // queued edits to other fields remain visible and get backed up too.
  const missing = recovery.cards.filter(
    (card) => !entry.board?.cards.some((current) => current.id === card.id),
  );
  return {
    ...local,
    cards: [
      ...local.cards.filter((card) => !missing.some((saved) => saved.id === card.id)),
      ...missing,
    ],
    columns: [
      ...local.columns,
      ...recovery.columns.filter(
        (column) =>
          missing.some((card) => card.columnId === column.id) &&
          !local.columns.some((current) => current.id === column.id),
      ),
    ],
  };
}

/** Persist operations before acknowledging a save; tabs upload one queue at a time. */
export function withOfflineBoards(
  remote: Remote,
  database = new OfflineDatabase<Entry>('pinboard-offline-v1', owner),
): OfflineBoards {
  let syncing: Promise<void> | undefined;
  let syncError = '';
  const boardErrors = new Map<string, Error>();
  async function begin(): Promise<string | null> {
    const identity = await database.owner();
    if (identity || !navigator.onLine || !remote.initialize) return identity;
    await remote.initialize();
    return database.owner();
  }
  async function sameOwner(identity: string | null): Promise<void> {
    if ((await database.owner()) !== identity)
      throw new Error('The device session changed. Your edits stay with their original session.');
  }
  async function remember(board: Board, identity: string | null): Promise<Board> {
    await sameOwner(identity);
    if (!identity) return board;
    const entry = await database.change(
      board.id,
      (current) => ({
        value: {
          ...current,
          board: current?.board && current.board.revision > board.revision ? current.board : board,
          summary: summarizeBoard(board),
          pending: current?.pending ?? [],
          draft: current?.draft,
        },
        queued: Boolean(current?.pending.length),
      }),
      identity,
    );
    await sameOwner(identity);
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
          boardErrors.delete(entry.summary.id);
          try {
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
                !latest.columns.some(
                  (column) => column.id === (sent.operation as { id: string }).id,
                )
                  ? latest
                  : await remote.mutateBoard(
                      entry.summary.id,
                      sent.operation,
                      sent.id,
                      sent.baseRevision ?? current.board?.revision,
                    );
              if ((await database.owner()) !== identity) return;
              current = await database.change(
                saved.id,
                (value) => {
                  const pending = (value?.pending ?? []).filter((change) => change.id !== sent.id);
                  return {
                    value: {
                      ...value,
                      board: saved,
                      summary: summarizeBoard(saved),
                      pending,
                      draft: pending.length ? value?.draft : undefined,
                    },
                    queued: pending.length > 0,
                  };
                },
                identity,
              );
            }
          } catch (error) {
            if (!(error instanceof BoardOperationError)) throw error;
            boardErrors.set(
              entry.summary.id,
              error instanceof Error ? error : new Error('Pending changes need attention.'),
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
    reviewPendingBoard: async (id) => {
      const identity = await database.owner();
      if (!identity)
        throw new Error('The saved device session is unavailable. Your edits are kept.');
      const shared = navigator.onLine ? await remote.loadBoard(id) : undefined;
      if ((await database.owner()) !== identity)
        throw new Error('The device session changed. Reopen this review.');
      const entry = await database.read(id);
      await sameOwner(identity);
      const local = entry && reviewDraft(entry, shared);
      if (!entry?.board || !local) throw new Error('The saved board is unavailable.');
      return {
        owner: identity,
        shared: shared ?? entry.board,
        local,
        pendingIds: entry.pending.map((change) => change.id),
        backups: entry.backups ?? [],
        online: Boolean(shared),
        unappliedBackupId: entry.unappliedBackupId,
        retryError: reviewRetryError(entry, shared ?? entry.board),
      };
    },
    resolvePendingBoard: async (review, action) => {
      if (!navigator.onLine || !review.online)
        throw new Error('Reconnect and refresh this review before choosing a version.');
      if (!navigator.locks)
        throw new Error('Reviewing pending edits needs browser Web Locks. Your draft is kept.');
      await navigator.locks.request(`pinboard-offline-sync:${review.owner}`, async () => {
        if ((await database.owner()) !== review.owner)
          throw new Error(
            'The device session changed. Your edits are kept with their original session.',
          );
        const shared = await remote.loadBoard(review.shared.id);
        if (shared.revision !== review.shared.revision)
          throw new Error('The shared board changed. Refresh this review before choosing.');
        await database.change(
          shared.id,
          (current) => {
            if (
              !current?.board ||
              current.pending.length !== review.pendingIds.length ||
              current.unappliedBackupId !== review.unappliedBackupId ||
              current.pending.some((change, index) => change.id !== review.pendingIds[index])
            )
              throw new Error(
                'Pending edits changed in another tab. Refresh this review before choosing.',
              );
            if (!current.pending.length && !current.unappliedBackupId)
              throw new Error('These edits already synced. Refresh this review.');
            const retryError = reviewRetryError(current, shared);
            if (action === 'retry' && retryError) throw new Error(retryError);
            const local = reviewDraft(current, shared)!;
            const pending =
              action === 'retry'
                ? current.pending.map((change) => ({
                    ...change,
                    id: crypto.randomUUID(),
                    baseRevision: shared.revision,
                  }))
                : [];
            return {
              value: {
                ...current,
                board: shared,
                summary: summarizeBoard(shared),
                pending,
                draft: pending.length ? local : undefined,
                unappliedBackupId: undefined,
                backups: [
                  ...(current.backups ?? []),
                  ...(current.unappliedBackupId && !current.pending.length
                    ? []
                    : [
                        {
                          id: crypto.randomUUID(),
                          board: structuredClone(local),
                          createdAt: new Date().toISOString(),
                        },
                      ]),
                ],
              },
              queued: pending.length > 0,
            };
          },
          review.owner,
        );
      });
      boardErrors.delete(review.shared.id);
      if (action === 'retry') {
        try {
          await sync();
        } catch (error) {
          if (!transient(error)) throw error;
        }
      }
      if ((await database.owner()) !== review.owner)
        throw new Error('The device session changed. Your draft stays with the original session.');
      const entry = await database.read(review.shared.id);
      await sameOwner(review.owner);
      const saved = project(entry!)!;
      const error = boardErrors.get(review.shared.id);
      return error ? { ...saved, localError: error.message } : saved;
    },
    loadBoardList: async (known) => {
      const identity = await begin();
      if (!identity) {
        const summaries = await remote.loadBoardList(known);
        await sameOwner(identity);
        return summaries;
      }
      if (navigator.onLine) {
        try {
          await sync();
          await sameOwner(identity);
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
          await sameOwner(identity);
          for (const summary of summaries)
            await database.change(
              summary.id,
              (entry) => ({
                value: { ...entry, summary, pending: entry?.pending ?? [] },
                queued: Boolean(entry?.pending.length),
              }),
              identity,
            );
          return Promise.all(
            summaries.map(async (summary) => {
              const entry = await database.read(summary.id);
              await sameOwner(identity);
              const board = entry?.pending.length ? project(entry) : undefined;
              const result = board ? summarizeBoard(board) : summary;
              const error = boardErrors.get(summary.id);
              return error ? { ...result, localError: error.message } : result;
            }),
          );
        } catch (error) {
          await sameOwner(identity);
          if (!(await database.all()).length) throw error;
          syncError = error instanceof Error ? error.message : 'Could not sync your boards.';
        }
      }
      const entries = await database.all();
      await sameOwner(identity);
      return entries.map((entry) => {
        const board = project(entry);
        return {
          ...(board ? summarizeBoard(board) : entry.summary),
          localCached: true,
          ...(syncError ? { localError: syncError } : {}),
        };
      });
    },
    loadBoard: async (id) => {
      const identity = await begin();
      if (!identity) {
        const board = await remote.loadBoard(id);
        await sameOwner(identity);
        return board;
      }
      if (navigator.onLine) {
        try {
          await sync();
          await sameOwner(identity);
          syncError = '';
          const board = await remember(await remote.loadBoard(id), identity);
          const error = boardErrors.get(id);
          return error ? { ...board, localError: error.message } : board;
        } catch (error) {
          await sameOwner(identity);
          if (!(await database.read(id))?.board) throw error;
          syncError = error instanceof Error ? error.message : 'Could not sync your board.';
        }
      }
      const entry = await database.read(id);
      await sameOwner(identity);
      const board = entry && project(entry);
      if (!board) throw new Error('Open this board online once before using it offline.');
      return { ...board, localCached: true, ...(syncError ? { localError: syncError } : {}) };
    },
    createBoard: async (id, title, description) => {
      validateUuid(id, 'Board ID');
      validateBoardDetails(title, description);
      const identity = await begin();
      return remember(await remote.createBoard(id, title, description), identity);
    },
    joinBoard: async (code) => {
      normalizeInviteCode(code);
      const identity = await begin();
      return remember(await remote.joinBoard(code), identity);
    },
    mutateBoard: async (id, operation, recovery) => {
      validateUuid(id, 'Board ID');
      validateOperation(operation);
      const identity = await begin();
      const cached = await database.read(id);
      await sameOwner(identity);
      if (!cached?.board) {
        if (!navigator.onLine)
          throw new Error(
            'You are offline. Open this board online once before editing it offline.',
          );
        return remember(await remote.mutateBoard(id, operation), identity);
      }
      if (!identity)
        throw new Error('The saved device session is unavailable. Your draft is kept.');
      const token = crypto.randomUUID();
      const entry = await database.change(
        id,
        (current) => {
          if (!current?.board)
            throw new Error('The saved board is unavailable. Your draft is kept.');
          const source = project(current)!;
          if (
            missingCard(source, operation) &&
            recovery?.id === id &&
            (operation.type === 'update_card' || operation.type === 'move_card')
          ) {
            // This snapshot is a device backup, not a board to publish. It also
            // preserves invalid/stale editor values for an explicit download.
            const draft = editorSnapshot(source, recovery, operation);
            const existing = recoveryBoard(current);
            const same = existing && JSON.stringify(existing) === JSON.stringify(draft);
            const backup = { id: token, board: draft, createdAt: new Date().toISOString() };
            return {
              value: {
                ...current,
                backups: same ? current.backups : [...(current.backups ?? []), backup],
                unappliedBackupId: same ? current.unappliedBackupId : backup.id,
              },
              queued: current.pending.length > 0,
            };
          }
          const draft = editorSnapshot(
            applyOfflineOperation(source, operation),
            recovery,
            operation,
          );
          return {
            value: {
              ...current,
              draft,
              pending: [
                ...current.pending,
                {
                  id: token,
                  operation: structuredClone(operation),
                  baseRevision: current.board.revision,
                },
              ],
            },
            queued: true,
          };
        },
        identity,
      );
      await sameOwner(identity);
      if (!entry.pending.some((change) => change.id === token))
        throw new BoardOperationError(unappliedMessage);
      if (navigator.onLine) {
        try {
          await sync();
          await sameOwner(identity);
          const error = boardErrors.get(id);
          if (error) throw error;
        } catch (error) {
          await sameOwner(identity);
          if (!transient(error)) throw error;
        }
      }
      const saved = await database.read(id);
      await sameOwner(identity);
      return project(saved ?? entry)!;
    },
  };
}

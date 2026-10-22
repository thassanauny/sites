import { vi } from 'vitest';
import type { Board, BoardSummary, Operation } from '../domain/boards/types';
import { summarizeBoard } from '../domain/boards/summary';

/** Fixture server snapshots; the application receives summaries and fetches details separately. */
export type BoardSnapshot = Board | BoardSummary;
const documents = new Map<string, Board>();
export const cloud = {
  configured: true,
  loadBoardList: vi.fn<(known: readonly BoardSummary[]) => Promise<BoardSnapshot[]>>(),
  loadBoard: vi.fn<(id: string) => Promise<Board>>(),
  createBoard: vi.fn(),
  joinBoard: vi.fn(),
  mutateBoard: vi.fn(),
  recoveryDraft: vi.fn<(board: Board) => void>(),
  startNewSession: vi.fn(),
  subscribeBoardChanges: vi.fn<
    (wake: () => void, health?: (healthy: boolean) => void) => () => void
  >(() => () => {}),
  reviewPendingBoard: vi.fn(),
  resolvePendingBoard: vi.fn(),
};

export function resetCloudDocuments() {
  documents.clear();
  cloud.loadBoard.mockImplementation(async (id) => {
    const board = documents.get(id);
    if (!board) throw new Error('Board details unavailable');
    return board;
  });
}

export const cloudModule = {
  get cloudConfigured() {
    return cloud.configured;
  },
  loadBoardList: async (known: readonly BoardSummary[]) => {
    const entries = await cloud.loadBoardList(known);
    return entries.map((entry) => {
      if (!('cards' in entry)) return entry;
      documents.set(entry.id, entry);
      return summarizeBoard(entry);
    });
  },
  loadBoard: cloud.loadBoard,
  createBoard: cloud.createBoard,
  joinBoard: cloud.joinBoard,
  // Existing UI assertions inspect the wire operation; recovery never goes to RPCs.
  mutateBoard: (id: string, operation: Operation, recovery?: Board) => {
    if (recovery) cloud.recoveryDraft(recovery);
    return cloud.mutateBoard(id, operation);
  },
  startNewSession: cloud.startNewSession,
  subscribeBoardChanges: (wake: () => void, health?: (healthy: boolean) => void) =>
    cloud.subscribeBoardChanges(wake, health) ?? (() => {}),
  reviewPendingBoard: cloud.reviewPendingBoard,
  resolvePendingBoard: cloud.resolvePendingBoard,
};

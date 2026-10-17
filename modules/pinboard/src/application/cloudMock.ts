import { vi } from 'vitest';
import type { Board, BoardSummary } from '../domain/boards/types';
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
  startNewSession: vi.fn(),
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
  mutateBoard: cloud.mutateBoard,
  startNewSession: cloud.startNewSession,
};

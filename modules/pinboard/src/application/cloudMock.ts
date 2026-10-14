import { vi } from 'vitest';

/** Shared state behind the mocked cloud module; test files register it with `vi.mock`. */
export const cloud = {
  configured: true,
  loadBoards: vi.fn(),
  createBoard: vi.fn(),
  joinBoard: vi.fn(),
  mutateBoard: vi.fn(),
  startNewSession: vi.fn(),
};

export const cloudModule = {
  get cloudConfigured() {
    return cloud.configured;
  },
  loadBoards: cloud.loadBoards,
  createBoard: cloud.createBoard,
  joinBoard: cloud.joinBoard,
  mutateBoard: cloud.mutateBoard,
  startNewSession: cloud.startNewSession,
};

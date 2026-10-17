import type { Board, BoardSummary } from './types';
import { activeCards, readBoard } from './board';

export function summarizeBoard(board: Board): BoardSummary {
  const { cards: _cards, card_fields: _fields, ...summary } = board;
  return {
    ...summary,
    description: Array.from(board.description).slice(0, 240).join(''),
    active_card_count: activeCards(board).length,
  };
}

export function readBoardSummary(input: unknown): BoardSummary {
  if (!input || typeof input !== 'object') throw new Error('Invalid board summary.');
  const { active_card_count, ...fields } = input as Record<string, unknown>;
  if (
    !Number.isInteger(active_card_count) ||
    Number(active_card_count) < 0 ||
    Number(active_card_count) > 2000
  )
    throw new Error('Invalid board count.');
  const board = readBoard({ ...fields, cards: [] });
  const { cards: _cards, card_fields: _settings, ...summary } = board;
  return { ...summary, active_card_count: Number(active_card_count) };
}

export function acceptSummary(
  current: BoardSummary | undefined,
  incoming: BoardSummary,
): BoardSummary {
  return current && current.revision >= incoming.revision ? current : incoming;
}

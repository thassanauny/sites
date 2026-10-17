import { describe, expect, it } from 'vitest';
import { summarizeBoard, readBoardSummary, acceptSummary } from './summary';
import type { Board } from './types';

describe('collection payload', () => {
  it('is independent of card bodies and preserves whole Unicode characters in previews', () => {
    const board: Board = {
      id: '11111111-1111-4111-8111-111111111111',
      invite_code: 'a'.repeat(32),
      title: 'Fixture',
      description: '😀'.repeat(400),
      columns: [{ id: 'todo', title: 'To do', color: 'slate' }],
      revision: 1,
      created_at: '2026-10-17T00:00:00Z',
      updated_at: '2026-10-17T00:00:00Z',
      cards: Array.from({ length: 100 }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        title: 'Card',
        description: 'Private card text. '.repeat(100),
        columnId: 'todo',
        position: i,
        priority: 'medium',
        assignee: '',
        dueDate: '',
        labels: [],
        archived: i % 2 === 0,
      })),
    };
    const summary = summarizeBoard(board);
    expect(summary.active_card_count).toBe(50);
    expect(Array.from(summary.description)).toHaveLength(240);
    expect(JSON.stringify(summary)).not.toContain('Private card text');
    const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
    expect(bytes(summary)).toBeLessThan(bytes(board) / 100);
    expect(readBoardSummary(summary)).toEqual(summary);
    const newerHead = { ...summary, revision: 2 };
    expect(acceptSummary(newerHead, summary)).toBe(newerHead);
    const cachedDocument = { ...summary, localCached: true };
    expect(acceptSummary(newerHead, cachedDocument)).toBe(cachedDocument);
  });
});

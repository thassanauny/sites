import { describe, expect, it } from 'vitest';
import type { Board, Card } from './types';
import { compareBoards } from './comparison';
import { boardSnapshot } from './board';
const card: Card = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Task',
  description: 'Original description',
  columnId: 'todo',
  position: 1024,
  priority: 'medium',
  assignee: '',
  dueDate: '',
  labels: [],
};
const board: Board = {
  id: '22222222-2222-4222-8222-222222222222',
  invite_code: 'a'.repeat(32),
  title: 'Project',
  description: '',
  columns: [
    { id: 'todo', title: 'To do', color: 'slate' },
    { id: 'done', title: 'Done', color: 'emerald' },
  ],
  cards: [card],
  revision: 1,
  created_at: '2026-10-10T00:00:00Z',
  updated_at: '2026-10-10T00:00:00Z',
};
describe('board version comparison', () => {
  it('shows only changed fields and ignores sync metadata, default archive flags and rank renumbering', () => {
    const local = structuredClone(board);
    local.cards[0] = { ...card, description: 'Our description', archived: false, position: 10 };
    local.revision = 2;
    local.localPending = true;
    expect(compareBoards(local, board)).toEqual([
      {
        id: `card:${card.id}:description`,
        label: 'Card: Task — Description',
        local: 'Our description',
        shared: 'Original description',
      },
    ]);
    expect(compareBoards(board, { ...board, revision: 9, localCached: true })).toEqual([]);
  });
  it('explains additions, deletions, moves, archives and custom field values without leaking IDs', () => {
    const field = { id: crypto.randomUUID(), title: 'Estimate', hidden: false };
    const shared = { ...structuredClone(board), card_fields: { hidden: [], custom: [field] } };
    shared.cards[0].customFields = { [field.id]: 'Small' };
    const local = structuredClone(shared);
    local.cards[0] = {
      ...local.cards[0],
      columnId: 'done',
      archived: true,
      customFields: { [field.id]: 'Large' },
    };
    expect(
      compareBoards(local, shared).map((change) => [change.label, change.local, change.shared]),
    ).toEqual([
      ['Card: Task — Column', 'Done', 'To do'],
      ['Card: Task — Archive', 'Archived', 'Active'],
      ['Card: Task — Estimate', 'Large', 'Small'],
    ]);
    expect(compareBoards(local, { ...shared, cards: [] })[0]).toMatchObject({
      label: 'Card: Task',
      shared: 'Not on the shared board',
    });
    expect(compareBoards({ ...local, cards: [] }, shared)[0]).toMatchObject({
      label: 'Card: Task',
      local: 'Removed from this device',
    });
  });
  it('compares column changes and ordering independently of card column names', () => {
    const local = structuredClone(board);
    local.columns[0].title = 'Planned';
    local.columns.reverse();
    expect(compareBoards(local, board).map((change) => change.label)).toEqual([
      'Column: Planned — Name',
      'Column order',
    ]);
  });
  it('handles a full-size board without reporting unchanged content', () => {
    const full = {
      ...board,
      cards: Array.from({ length: 2000 }, (_, i) => ({
        ...card,
        id: crypto.randomUUID(),
        position: i,
      })),
    };
    expect(compareBoards(full, structuredClone(full))).toEqual([]);
  });
  it('exports only validated editable content for recovery actions', () => {
    expect(Object.keys(boardSnapshot({ ...board, localPending: true }))).toEqual([
      'title',
      'description',
      'columns',
      'cards',
    ]);
    expect(() => boardSnapshot({ ...board, cards: [{ ...card, columnId: 'missing' }] })).toThrow(
      'column',
    );
  });
});

import { describe, expect, it } from 'vitest';
import {
  acceptBoard,
  cardPatch,
  readBoard,
  readCardFieldSettings,
  validateOperation,
} from './board';
import { boardAssignees, FIELD_LIMITS, sameFieldSettings } from './fields';
import type { Board, Card } from './types';

const id = '11111111-1111-4111-8111-111111111111';
const second = '22222222-2222-4222-8222-222222222222';
const settings = { hidden: ['assignee'] as const, custom: [{ id, title: 'Team', hidden: false }] };
const card: Card = {
  id: second,
  title: 'Plan',
  description: '',
  columnId: 'todo',
  position: 1024,
  priority: 'medium',
  assignee: '',
  dueDate: '',
  labels: [],
  customFields: { [id]: 'Supply' },
};
const board: Board = {
  id: second,
  invite_code: 'a'.repeat(32),
  title: 'Board',
  description: '',
  columns: [{ id: 'todo', title: 'To do', color: 'slate' }],
  cards: [card],
  revision: 1,
  created_at: '2026-10-15T00:00:00Z',
  updated_at: '2026-10-15T00:00:00Z',
  card_fields: { ...settings, hidden: [...settings.hidden] },
};

describe('shared card field data', () => {
  it('keeps saved assignees without cards and validates a bounded unique list', () => {
    const configured = {
      ...board,
      card_fields: { ...board.card_fields!, assignees: ['Sam', 'Alex'] },
    };
    const copy = readBoard(configured);
    expect(boardAssignees(copy)).toEqual(['Alex', 'Sam']);
    expect(copy.card_fields!.assignees).not.toBe(configured.card_fields.assignees);
    expect(sameFieldSettings(board.card_fields, copy.card_fields)).toBe(false);
    expect(acceptBoard(board, copy).card_fields?.assignees).toEqual(['Sam', 'Alex']);
    for (const assignees of [
      null,
      [''],
      ['Alex', 'Alex'],
      ['x'.repeat(81)],
      [42],
      Array.from({ length: FIELD_LIMITS.assignees + 1 }, (_, i) => `Person ${i}`),
    ])
      expect(() => readCardFieldSettings({ ...board.card_fields, assignees })).toThrow();
  });
  it('clones settings and custom values and retains identity on unchanged polls', () => {
    const copy = readBoard(board);
    expect(copy).toEqual(board);
    expect(acceptBoard(board, copy)).toBe(board);
    copy.card_fields!.custom[0]!.title = 'Department';
    copy.cards[0]!.customFields![id] = 'Platform';
    expect(board.card_fields!.custom[0]!.title).toBe('Team');
    expect(card.customFields![id]).toBe('Supply');
    const changed = acceptBoard(board, { ...copy, revision: 2 });
    expect(changed.cards[0]!.customFields![id]).toBe('Platform');
    expect(changed.card_fields!.custom[0]!.title).toBe('Department');
    expect(sameFieldSettings(undefined, { hidden: [], custom: [] })).toBe(true);
  });

  it('sends only changed custom IDs, including explicit clears', () => {
    const original = { ...card, customFields: { [id]: 'Supply', [second]: 'Keep' } };
    expect(
      cardPatch(original, { ...original, customFields: { [id]: 'Platform', [second]: 'Keep' } }),
    ).toEqual({ customFields: { [id]: 'Platform' } });
    expect(cardPatch(original, { ...original, customFields: { [second]: 'Keep' } })).toEqual({
      customFields: { [id]: '' },
    });
    expect(cardPatch(card, { ...card, customFields: { ...card.customFields } })).toEqual({});
  });

  it('rejects malformed, duplicated, reserved and oversized definitions', () => {
    const valid = board.card_fields!;
    for (const input of [
      { ...valid, hidden: ['title'] },
      { ...valid, hidden: ['assignee', 'assignee'] },
      { ...valid, custom: [{ id, title: 'Priority', hidden: false }] },
      { ...valid, custom: [{ id, title: 'x'.repeat(FIELD_LIMITS.title + 1), hidden: false }] },
      {
        ...valid,
        custom: [
          { id, title: 'Team', hidden: false },
          { id: second, title: ' team ', hidden: true },
        ],
      },
      { ...valid, custom: [{ id, title: 'Team', hidden: 'yes' }] },
      { ...valid, custom: Array(FIELD_LIMITS.custom + 1).fill(valid.custom[0]) },
      { ...valid, unsupported: true },
    ])
      expect(() => readCardFieldSettings(input)).toThrow();
    expect(() => readBoard({ ...board, card_fields: undefined })).toThrow('configured field');
    expect(() =>
      validateOperation({
        type: 'update_card',
        id: card.id,
        patch: { customFields: { [id]: 'x'.repeat(FIELD_LIMITS.value + 1) } },
      }),
    ).toThrow('1000');
    expect(() =>
      validateOperation({
        type: 'update_card',
        id: card.id,
        patch: { customFields: JSON.parse('{"__proto__":"bad"}') },
      }),
    ).toThrow('unsupported field');
  });
});

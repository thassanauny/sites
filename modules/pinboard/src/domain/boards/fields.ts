import type { Board, CardFieldSettings, OptionalCardField } from './types';

export const OPTIONAL_CARD_FIELDS: ReadonlyArray<{ id: OptionalCardField; title: string }> = [
  { id: 'description', title: 'Description' },
  { id: 'priority', title: 'Priority' },
  { id: 'assignee', title: 'Assignee' },
  { id: 'dueDate', title: 'Due date' },
  { id: 'labels', title: 'Labels' },
];

export const FIELD_LIMITS = { custom: 12, title: 40, value: 1000, assignees: 2000 } as const;
const defaults: CardFieldSettings = { hidden: [], custom: [] };

export const cardFields = (board: Board): CardFieldSettings => board.card_fields ?? defaults;
export const fieldVisible = (settings: CardFieldSettings, field: OptionalCardField): boolean =>
  !settings.hidden.includes(field);

export function boardAssignees(board: Board): string[] {
  return [
    ...new Set(
      board.card_fields?.assignees ?? board.cards.map((card) => card.assignee).filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
}

export function sameFieldSettings(left?: CardFieldSettings, right?: CardFieldSettings): boolean {
  const a = left ?? defaults;
  const b = right ?? defaults;
  return (
    a.hidden.length === b.hidden.length &&
    a.hidden.every((id) => b.hidden.includes(id)) &&
    (a.assignees?.length ?? 0) === (b.assignees?.length ?? 0) &&
    (a.assignees ?? []).every((name) => b.assignees?.includes(name)) &&
    a.custom.length === b.custom.length &&
    a.custom.every((field, index) => {
      const other = b.custom[index]!;
      return field.id === other.id && field.title === other.title && field.hidden === other.hidden;
    })
  );
}

export function sameCustomValues(
  left: Record<string, string> = {},
  right: Record<string, string> = {},
): boolean {
  return (
    Object.keys(left).length === Object.keys(right).length &&
    Object.keys(left).every((id) => left[id] === right[id])
  );
}

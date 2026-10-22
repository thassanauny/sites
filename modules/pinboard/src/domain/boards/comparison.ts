import type { Board, Card } from './types';
import { sortedCards } from './board';

export interface BoardDifference {
  id: string;
  label: string;
  local: string;
  shared: string;
}
const text = (value: unknown): string =>
  value === undefined
    ? 'Not set'
    : value === ''
      ? 'Empty'
      : Array.isArray(value)
        ? value.join(', ') || 'None'
        : String(value);
const columnName = (board: Board, id: string) =>
  board.columns.find((column) => column.id === id)?.title ?? 'Removed column';
const cardText = (board: Board, card: Card) =>
  [
    card.title,
    card.description,
    `Column: ${columnName(board, card.columnId)}`,
    `Priority: ${card.priority}`,
    card.assignee && `Assigned to: ${card.assignee}`,
    card.dueDate && `Due: ${card.dueDate}`,
    card.labels.length && `Labels: ${card.labels.join(', ')}`,
    card.archived && 'Archived',
    ...Object.entries(card.customFields ?? {}).map(
      ([id, value]) =>
        `${board.card_fields?.custom.find((field) => field.id === id)?.title ?? 'Custom field'}: ${value}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

/** Compare editable content only, hiding unchanged fields, identity and sync metadata. */
export function compareBoards(local: Board, shared: Board): BoardDifference[] {
  const changes: BoardDifference[] = [];
  const add = (
    id: string,
    label: string,
    ours: unknown,
    theirs: unknown,
    ourText = text(ours),
    theirText = text(theirs),
  ) => {
    if (JSON.stringify(ours) !== JSON.stringify(theirs))
      changes.push({ id, label, local: ourText, shared: theirText });
  };
  add('title', 'Board name', local.title, shared.title);
  add('description', 'Board description', local.description, shared.description);
  add(
    'hidden',
    'Hidden card fields',
    [...(local.card_fields?.hidden ?? [])].sort(),
    [...(shared.card_fields?.hidden ?? [])].sort(),
  );
  add(
    'assignees',
    'Assignees',
    local.card_fields?.assignees ?? [],
    shared.card_fields?.assignees ?? [],
  );
  for (const id of new Set([...local.columns, ...shared.columns].map((column) => column.id))) {
    const ours = local.columns.find((column) => column.id === id),
      theirs = shared.columns.find((column) => column.id === id);
    const label = `Column: ${ours?.title ?? theirs!.title}`;
    if (!ours || !theirs) {
      changes.push({
        id: `column:${id}`,
        label,
        local: ours ? `${ours.title} · ${ours.color}` : 'Removed from this device',
        shared: theirs ? `${theirs.title} · ${theirs.color}` : 'Not on the shared board',
      });
    } else {
      add(`column:${id}:title`, `${label} — Name`, ours.title, theirs.title);
      add(`column:${id}:color`, `${label} — Color`, ours.color, theirs.color);
    }
  }
  const common = new Set(
    local.columns
      .filter((column) => shared.columns.some((other) => other.id === column.id))
      .map((column) => column.id),
  );
  add(
    'column-order',
    'Column order',
    local.columns.filter((column) => common.has(column.id)).map((column) => column.id),
    shared.columns.filter((column) => common.has(column.id)).map((column) => column.id),
    local.columns.map((column) => column.title).join(' → '),
    shared.columns.map((column) => column.title).join(' → '),
  );
  for (const id of new Set(
    [...(local.card_fields?.custom ?? []), ...(shared.card_fields?.custom ?? [])].map(
      (field) => field.id,
    ),
  )) {
    const ours = local.card_fields?.custom.find((field) => field.id === id),
      theirs = shared.card_fields?.custom.find((field) => field.id === id);
    add(
      `field:${id}`,
      `Custom field: ${ours?.title ?? theirs!.title}`,
      ours,
      theirs,
      ours ? `${ours.title} · ${ours.hidden ? 'Hidden' : 'Visible'}` : 'Removed from this device',
      theirs
        ? `${theirs.title} · ${theirs.hidden ? 'Hidden' : 'Visible'}`
        : 'Not on the shared board',
    );
  }
  const localCards = new Map(local.cards.map((card) => [card.id, card])),
    sharedCards = new Map(shared.cards.map((card) => [card.id, card]));
  const commonCards = new Set(
    local.cards
      .filter((card) => {
        const other = sharedCards.get(card.id);
        return other && other.columnId === card.columnId && !card.archived && !other.archived;
      })
      .map((card) => card.id),
  );
  const ranks = (board: Board) =>
    new Map(
      board.columns.flatMap((column) =>
        sortedCards(board, column.id)
          .filter((card) => commonCards.has(card.id))
          .map((card, index) => [card.id, index + 1] as const),
      ),
    );
  const localRanks = ranks(local),
    sharedRanks = ranks(shared);
  for (const id of new Set([...localCards.keys(), ...sharedCards.keys()])) {
    const ours = localCards.get(id),
      theirs = sharedCards.get(id);
    const label = `Card: ${ours?.title ?? theirs!.title}`;
    if (!ours || !theirs) {
      changes.push({
        id: `card:${id}`,
        label,
        local: ours ? cardText(local, ours) : 'Removed from this device',
        shared: theirs ? cardText(shared, theirs) : 'Not on the shared board',
      });
      continue;
    }
    for (const [key, name] of [
      ['title', 'Title'],
      ['description', 'Description'],
      ['priority', 'Priority'],
      ['assignee', 'Assignee'],
      ['dueDate', 'Due date'],
      ['labels', 'Labels'],
    ] as const)
      add(`card:${id}:${key}`, `${label} — ${name}`, ours[key], theirs[key]);
    add(
      `card:${id}:column`,
      `${label} — Column`,
      ours.columnId,
      theirs.columnId,
      columnName(local, ours.columnId),
      columnName(shared, theirs.columnId),
    );
    add(
      `card:${id}:archive`,
      `${label} — Archive`,
      Boolean(ours.archived),
      Boolean(theirs.archived),
      ours.archived ? 'Archived' : 'Active',
      theirs.archived ? 'Archived' : 'Active',
    );
    if (ours.columnId === theirs.columnId && !ours.archived && !theirs.archived) {
      add(`card:${id}:order`, `${label} — Order`, localRanks.get(id), sharedRanks.get(id));
    }
    for (const field of new Set([
      ...Object.keys(ours.customFields ?? {}),
      ...Object.keys(theirs.customFields ?? {}),
    ]))
      add(
        `card:${id}:field:${field}`,
        `${label} — ${local.card_fields?.custom.find((item) => item.id === field)?.title ?? shared.card_fields?.custom.find((item) => item.id === field)?.title ?? 'Custom field'}`,
        ours.customFields?.[field] ?? '',
        theirs.customFields?.[field] ?? '',
      );
  }
  return changes;
}

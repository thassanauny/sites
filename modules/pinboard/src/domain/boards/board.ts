import type {
  Board,
  BoardHead,
  Card,
  CardPatch,
  CardPriority,
  Column,
  ColumnColor,
  Operation,
} from './types';

export const COLUMN_COLORS: readonly ColumnColor[] = [
  'slate',
  'blue',
  'amber',
  'emerald',
  'rose',
  'violet',
];
const PRIORITIES: readonly CardPriority[] = ['low', 'medium', 'high'];
/** Capacity and text limits. `supabase/schema.sql` enforces the same numbers; limits.test.ts compares them. */
export const LIMITS = {
  columns: 20,
  cards: 2_000,
  title: 160,
  description: 10_000,
  assignee: 80,
  label: 30,
  labels: 8,
  position: 1_000_000_000_000,
} as const;

const BOARD_KEYS = [
  'id',
  'invite_code',
  'title',
  'description',
  'columns',
  'cards',
  'revision',
  'created_at',
  'updated_at',
];
const COLUMN_KEYS = ['id', 'title', 'color'];
const CARD_KEYS = [
  'id',
  'title',
  'description',
  'columnId',
  'position',
  'priority',
  'assignee',
  'dueDate',
  'labels',
];
const CARD_PATCH_KEYS = CARD_KEYS.filter((key) => key !== 'id');
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function fail(message: string): never {
  throw new Error(message);
}

/** `ignoreUnknown` skips (never reads) fields that are not listed, for objects a newer server may extend. */
function record(
  input: unknown,
  label: string,
  allowed: readonly string[],
  ignoreUnknown = false,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    fail(`${label} must be an object.`);
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null)
    fail(`${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key))
      fail(`${label} contains an unsupported field.`);
    if (!allowed.includes(key)) {
      if (ignoreUnknown) continue;
      fail(`${label} contains an unsupported field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor)) fail(`${label} must contain ordinary values.`);
  }
  return input as Record<string, unknown>;
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are rejected on purpose.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function text(input: unknown, label: string, maximum: number, required = true): string {
  if (typeof input !== 'string' || input.length > maximum || CONTROL_CHARACTERS.test(input)) {
    fail(`${label} must be text of at most ${maximum} characters.`);
  }
  if (required && !input.trim()) fail(`${label} is required.`);
  return input;
}

export function validateUuid(input: unknown, label = 'ID'): string {
  if (
    typeof input !== 'string' ||
    !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(input)
  ) {
    fail(`${label} is invalid.`);
  }
  return input.toLowerCase();
}

function columnId(input: unknown, label = 'Column ID'): string {
  if (
    typeof input !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(input) ||
    FORBIDDEN_KEYS.has(input)
  ) {
    fail(`${label} is invalid.`);
  }
  return input;
}

function columnOrder(input: unknown): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > LIMITS.columns) {
    fail(`Column order needs between 1 and ${LIMITS.columns} column IDs.`);
  }
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) {
      fail('Column order contains an unsupported field.');
    }
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor)) fail('Column order must contain ordinary values.');
  }
  // Read ordinary own values directly, rejecting holes and avoiding custom iterators.
  const ids: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    ids.push(columnId(Object.getOwnPropertyDescriptor(input, String(index))?.value));
  }
  if (new Set(ids).size !== ids.length) fail('Column IDs must be unique.');
  return ids;
}

function color(input: unknown): ColumnColor {
  if (!COLUMN_COLORS.includes(input as ColumnColor)) fail('Choose a supported column color.');
  return input as ColumnColor;
}

function priority(input: unknown): CardPriority {
  if (!PRIORITIES.includes(input as CardPriority)) fail('Choose a supported card priority.');
  return input as CardPriority;
}

function position(input: unknown): number {
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    input > LIMITS.position
  ) {
    fail(`Card position must be between 0 and ${LIMITS.position}.`);
  }
  return input;
}

function calendarDate(input: unknown, optional = true): string {
  if (optional && input === '') return '';
  if (typeof input !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input))
    fail('Use a due date in YYYY-MM-DD format.');
  if (input.startsWith('0000-')) fail('The date is invalid.');
  const parsed = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input)
    fail('The date is invalid.');
  return input;
}

function timestamp(input: unknown, label: string): string {
  // Postgres JSON includes a UTC offset and can retain microseconds.
  if (
    typeof input !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      input,
    )
  ) {
    fail(`${label} must be an ISO timestamp.`);
  }
  calendarDate(input.slice(0, 10), false);
  if (!Number.isFinite(Date.parse(input))) fail(`${label} is invalid.`);
  return input;
}

function labels(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > LIMITS.labels)
    fail(`Cards support up to ${LIMITS.labels} labels.`);
  return Array.from(input, (label) => text(label, 'Label', LIMITS.label));
}

function readColumn(input: unknown): Column {
  const value = record(input, 'Column', COLUMN_KEYS);
  return {
    id: columnId(value.id),
    title: text(value.title, 'Column title', LIMITS.title),
    color: color(value.color),
  };
}

function readCard(input: unknown): Card {
  const value = record(input, 'Card', CARD_KEYS);
  return {
    id: validateUuid(value.id, 'Card ID'),
    title: text(value.title, 'Card title', LIMITS.title),
    description: text(value.description, 'Card description', LIMITS.description, false),
    columnId: columnId(value.columnId),
    position: position(value.position),
    priority: priority(value.priority),
    assignee: text(value.assignee, 'Assignee', LIMITS.assignee, false),
    dueDate: calendarDate(value.dueDate),
    labels: labels(value.labels),
  };
}

function revisionOf(input: unknown): number {
  const revision = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : input;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 1)
    fail('The board revision is invalid.');
  return revision;
}

/** Only plain, bounded data enters the UI, and every nested array is cloned. Unknown top-level fields are ignored. */
export function readBoard(input: unknown): Board {
  const value = record(input, 'Board', BOARD_KEYS, true);
  if (
    !Array.isArray(value.columns) ||
    value.columns.length < 1 ||
    value.columns.length > LIMITS.columns
  ) {
    fail(`Boards need between 1 and ${LIMITS.columns} columns.`);
  }
  if (!Array.isArray(value.cards) || value.cards.length > LIMITS.cards)
    fail(`Boards support up to ${LIMITS.cards} cards.`);
  const columns = Array.from(value.columns, readColumn);
  const columnIds = new Set(columns.map((column) => column.id));
  if (columnIds.size !== columns.length) fail('Column IDs must be unique.');
  const cards = Array.from(value.cards, readCard);
  if (new Set(cards.map((card) => card.id)).size !== cards.length) fail('Card IDs must be unique.');
  if (cards.some((card) => !columnIds.has(card.columnId)))
    fail('Each card must belong to an existing column.');
  if (typeof value.invite_code !== 'string' || !/^[a-f0-9]{32}$/.test(value.invite_code))
    fail('The board invite code is invalid.');
  const revision = revisionOf(value.revision);
  const createdAt = timestamp(value.created_at, 'Board creation time');
  const updatedAt = timestamp(value.updated_at, 'Board update time');
  if (Date.parse(updatedAt) < Date.parse(createdAt))
    fail('Board update time cannot precede its creation time.');
  return {
    id: validateUuid(value.id, 'Board ID'),
    invite_code: value.invite_code,
    title: text(value.title, 'Board title', LIMITS.title),
    description: text(value.description, 'Board description', LIMITS.description, false),
    columns,
    cards,
    revision,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

/** What a poll reads for each joined board: enough to tell whether the full board changed. */
export function readBoardHead(input: unknown): BoardHead {
  const value = record(input, 'Board', ['id', 'revision'], true);
  return {
    id: validateUuid(value.id, 'Board ID'),
    revision: revisionOf(value.revision),
  };
}

export function normalizeInviteCode(input: string): string {
  if (typeof input !== 'string') fail('Enter the complete 32-character invite code.');
  const normalized = input.trim().replace(/\s+/g, '').toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalized)) fail('Enter the complete 32-character invite code.');
  return normalized;
}

export function readInviteCode(input: string): string {
  const trimmed = input.trim();
  const hash = trimmed.includes('#') ? trimmed.slice(trimmed.indexOf('#')) : '';
  const link = /^#\/?(?:board|join)\/(.+)$/is.exec(hash);
  return normalizeInviteCode(link ? link[1] : input);
}

export function sortedCards(board: Board, id: string): Card[] {
  return board.cards
    .filter((card) => card.columnId === id)
    .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
}

export function nextPosition(board: Board, id: string): number {
  const maximum = board.cards.reduce(
    (current, card) => (card.columnId === id ? Math.max(current, card.position) : current),
    0,
  );
  return Math.min(maximum + 1_024, LIMITS.position);
}

/** Include fields the editor changed, preserving other members' independent edits. */
export function cardPatch(original: Card, edited: Card): CardPatch {
  const patch: CardPatch = {};
  for (const key of CARD_PATCH_KEYS as (keyof CardPatch)[]) {
    if (key === 'labels') {
      if (
        original.labels.length !== edited.labels.length ||
        original.labels.some((label, index) => label !== edited.labels[index])
      ) {
        patch.labels = [...edited.labels];
      }
    } else if (original[key] !== edited[key]) {
      Object.assign(patch, { [key]: edited[key] });
    }
  }
  return patch;
}

function sameCard(left: Card, right: Card): boolean {
  return (
    left.title === right.title &&
    left.description === right.description &&
    left.columnId === right.columnId &&
    left.position === right.position &&
    left.priority === right.priority &&
    left.assignee === right.assignee &&
    left.dueDate === right.dueDate &&
    left.labels.length === right.labels.length &&
    left.labels.every((label, index) => label === right.labels[index])
  );
}

function sameColumn(left: Column, right: Column): boolean {
  return left.title === right.title && left.color === right.color;
}

/** Keep the previous objects for entries that did not change, and the previous array when nothing did. */
function shareEntries<T extends { id: string }>(
  previous: T[],
  next: T[],
  same: (left: T, right: T) => boolean,
): T[] {
  const known = new Map(previous.map((item) => [item.id, item]));
  let identical = previous.length === next.length;
  const entries = next.map((item, index) => {
    const before = known.get(item.id);
    const entry = before && same(before, item) ? before : item;
    if (entry !== previous[index]) identical = false;
    return entry;
  });
  return identical ? previous : entries;
}

/** A refresh of an unchanged board keeps its identity, so views can skip re-rendering it. */
function shareBoard(previous: Board, next: Board): Board {
  if (previous === next) return previous;
  const columns = shareEntries(previous.columns, next.columns, sameColumn);
  const cards = shareEntries(previous.cards, next.cards, sameCard);
  if (
    columns === previous.columns &&
    cards === previous.cards &&
    previous.invite_code === next.invite_code &&
    previous.title === next.title &&
    previous.description === next.description &&
    previous.revision === next.revision &&
    previous.created_at === next.created_at &&
    previous.updated_at === next.updated_at
  )
    return previous;
  return { ...next, columns, cards };
}

/** A delayed refresh must never undo a newer successful save; unchanged parts keep their identity. */
export function acceptBoard(current: Board | undefined, incoming: Board): Board {
  if (current?.id !== incoming.id) return incoming;
  return current.revision > incoming.revision ? current : shareBoard(current, incoming);
}

function readPatch(input: unknown, kind: 'board' | 'column' | 'card'): Record<string, unknown> {
  const allowed =
    kind === 'board'
      ? ['title', 'description']
      : kind === 'column'
        ? ['title', 'color']
        : CARD_PATCH_KEYS;
  const value = record(input, 'Changes', allowed);
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    switch (key) {
      case 'title':
        patch.title = text(value.title, `${kind} title`, LIMITS.title);
        break;
      case 'description':
        patch.description = text(
          value.description,
          `${kind} description`,
          LIMITS.description,
          false,
        );
        break;
      case 'color':
        patch.color = color(value.color);
        break;
      case 'columnId':
        patch.columnId = columnId(value.columnId);
        break;
      case 'position':
        patch.position = position(value.position);
        break;
      case 'priority':
        patch.priority = priority(value.priority);
        break;
      case 'assignee':
        patch.assignee = text(value.assignee, 'Assignee', LIMITS.assignee, false);
        break;
      case 'dueDate':
        patch.dueDate = calendarDate(value.dueDate);
        break;
      case 'labels':
        patch.labels = labels(value.labels);
        break;
    }
  }
  return patch;
}

export function validateOperation(input: unknown): Operation {
  const value = record(input, 'Board action', [
    'type',
    'patch',
    'column',
    'card',
    'id',
    'targetColumnId',
    'columnId',
    'columnIds',
    'position',
  ]);
  const only = (keys: string[]) => record(input, 'Board action', ['type', ...keys]);
  switch (value.type) {
    case 'update_board':
      only(['patch']);
      return { type: value.type, patch: readPatch(value.patch, 'board') };
    case 'add_column':
      only(['column']);
      return { type: value.type, column: readColumn(value.column) };
    case 'update_column':
      only(['id', 'patch']);
      return {
        type: value.type,
        id: columnId(value.id),
        patch: readPatch(value.patch, 'column'),
      };
    case 'reorder_columns':
      only(['columnIds']);
      return { type: value.type, columnIds: columnOrder(value.columnIds) };
    case 'delete_column': {
      only(['id', 'targetColumnId']);
      const id = columnId(value.id);
      const targetColumnId = columnId(value.targetColumnId, 'Destination column');
      if (id === targetColumnId) fail('Choose a different column for the remaining cards.');
      return { type: value.type, id, targetColumnId };
    }
    case 'create_card':
      only(['card']);
      return { type: value.type, card: readCard(value.card) };
    case 'update_card':
      only(['id', 'patch']);
      return {
        type: value.type,
        id: validateUuid(value.id, 'Card ID'),
        patch: readPatch(value.patch, 'card'),
      };
    case 'move_card':
      only(['id', 'columnId', 'position']);
      return {
        type: value.type,
        id: validateUuid(value.id, 'Card ID'),
        columnId: columnId(value.columnId),
        position: position(value.position),
      };
    case 'delete_card':
      only(['id']);
      return { type: value.type, id: validateUuid(value.id, 'Card ID') };
    default:
      return fail('This board action is unsupported.');
  }
}

export function validateBoardDetails(
  title: unknown,
  description: unknown,
): { title: string; description: string } {
  return {
    title: text(title, 'Board title', LIMITS.title),
    description: text(description, 'Board description', LIMITS.description, false),
  };
}

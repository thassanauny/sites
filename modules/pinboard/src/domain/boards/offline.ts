import { readBoard, validateOperation } from './board';
import type { Board, Operation } from './types';

/** Apply only the queued operation's fields; cloud reconciliation still uses the server's operations. */
export function applyOfflineOperation(source: Board, input: Operation): Board {
  const operation = validateOperation(input);
  const board = structuredClone(source);
  switch (operation.type) {
    case 'update_board': {
      const fields = operation.patch.card_fields;
      const previous = board.card_fields;
      Object.assign(board, operation.patch);
      if (fields)
        board.card_fields = {
          hidden: fields.hidden,
          custom: [
            ...fields.custom,
            ...(previous?.custom ?? []).filter(
              (field) => !fields.custom.some((item) => item.id === field.id),
            ),
          ],
          ...(previous?.assignees ? { assignees: previous.assignees } : {}),
        };
      break;
    }
    case 'add_assignee':
    case 'delete_assignee': {
      board.card_fields ??= { hidden: [], custom: [] };
      const names =
        board.card_fields.assignees ??
        [...new Set(board.cards.map((card) => card.assignee).filter(Boolean))].sort();
      board.card_fields.assignees =
        operation.type === 'add_assignee'
          ? [...new Set([...names, operation.name])]
          : names.filter((name) => name !== operation.name);
      if (operation.type === 'delete_assignee')
        board.cards = board.cards.map((card) =>
          card.assignee === operation.name ? { ...card, assignee: '' } : card,
        );
      break;
    }
    case 'add_column':
      if (!board.columns.some((column) => column.id === operation.column.id))
        board.columns.push(operation.column);
      break;
    case 'update_column': {
      const column = board.columns.find((column) => column.id === operation.id);
      if (!column)
        throw new Error('That column was removed. Your pending edits are kept on this device.');
      Object.assign(column, operation.patch);
      break;
    }
    case 'reorder_columns': {
      const rank = (id: string) => {
        const index = operation.columnIds.indexOf(id);
        return index < 0 ? 21 : index;
      };
      board.columns.sort((a, b) => rank(a.id) - rank(b.id));
      break;
    }
    case 'delete_column': {
      if (!board.columns.some((column) => column.id === operation.id)) break;
      if (
        !board.columns.some((column) => column.id === operation.targetColumnId) ||
        board.columns.length < 2
      )
        throw new Error('Choose an available destination column.');
      const offset = Math.max(
        0,
        ...board.cards
          .filter((card) => card.columnId === operation.targetColumnId)
          .map((card) => card.position),
      );
      board.cards
        .filter((card) => card.columnId === operation.id)
        .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
        .forEach((card, index) => {
          card.columnId = operation.targetColumnId;
          card.position = Math.min(1e12, offset + 1024 * (index + 1));
        });
      board.columns = board.columns.filter((column) => column.id !== operation.id);
      break;
    }
    case 'create_card':
      if (!board.cards.some((card) => card.id === operation.card.id))
        board.cards.push(operation.card);
      break;
    case 'update_card':
    case 'move_card': {
      const card = board.cards.find((card) => card.id === operation.id);
      if (!card)
        throw new Error('That card was removed. Your pending edits are kept on this device.');
      const patch =
        operation.type === 'update_card'
          ? operation.patch
          : { columnId: operation.columnId, position: operation.position };
      const customFields = card.customFields;
      Object.assign(card, patch);
      if ('customFields' in patch) card.customFields = { ...customFields, ...patch.customFields };
      break;
    }
    case 'delete_card':
      board.cards = board.cards.filter((card) => card.id !== operation.id);
      break;
  }
  const { localPending: _pending, ...clean } = board;
  return { ...readBoard(clean), localPending: true };
}

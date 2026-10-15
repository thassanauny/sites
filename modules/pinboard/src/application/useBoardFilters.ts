import { useCallback, useMemo, useState } from 'react';
import type { Board, Card, CardFilters } from '../domain/boards/types';
import { sortedCards } from '../domain/boards/board';
import { cardFields, fieldVisible } from '../domain/boards/fields';

const noFilters: CardFilters = { query: '', priority: 'all', assignee: '' };

/** One filter state supplies both the board and its sidebar summary. */
export function useBoardFilters(board: Board | undefined, resetKey: number) {
  const [filters, setFilters] = useState(noFilters);
  const [seen, setSeen] = useState({ resetKey, boardId: board?.id });
  if (seen.resetKey !== resetKey || seen.boardId !== board?.id) {
    setSeen({ resetKey, boardId: board?.id });
    setFilters(noFilters);
  }
  const clearFilters = useCallback(() => setFilters(noFilters), []);
  const orderedCards = useMemo(
    () => board?.columns.map((column) => sortedCards(board, column.id)) ?? [],
    [board],
  );
  const columnCards = useMemo(() => {
    if (!board) return [];
    const fields = cardFields(board);
    const { query, priority, assignee } = filters;
    const activePriority = fieldVisible(fields, 'priority') ? priority : 'all';
    const activeAssignee = fieldVisible(fields, 'assignee') ? assignee : '';
    const needle = query.toLowerCase();
    const matches = (card: Card) =>
      (activePriority === 'all' || card.priority === activePriority) &&
      (!activeAssignee || card.assignee === activeAssignee.slice('name:'.length)) &&
      (needle === '' ||
        [
          card.title,
          fieldVisible(fields, 'description') ? card.description : '',
          fieldVisible(fields, 'assignee') ? card.assignee : '',
          fieldVisible(fields, 'labels') ? card.labels.join(' ') : '',
          ...fields.custom
            .filter((field) => !field.hidden)
            .map((field) => card.customFields?.[field.id] ?? ''),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle));
    return orderedCards.map((cards) => cards.filter(matches));
  }, [board, orderedCards, filters]);
  const filteredCount = columnCards.reduce((total, cards) => total + cards.length, 0);
  return { filters, setFilters, clearFilters, orderedCards, columnCards, filteredCount };
}

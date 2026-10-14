import { memo, useMemo, useState } from 'react';
import { Columns3, Plus, RefreshCw, Search, Settings2, Users } from 'lucide-react';
import type { Board, Card, Column } from '../../domain/boards/types';
import { LIMITS, sortedCards } from '../../domain/boards/board';
import { ColumnView } from './ColumnView';

interface Filters {
  query: string;
  priority: string;
  assignee: string;
}
const noFilters: Filters = { query: '', priority: 'all', assignee: '' };

/** Search and filter choices; they start over whenever the address changes. */
function useFilters(resetKey: number) {
  const [filters, setFilters] = useState(noFilters);
  const [seenKey, setSeenKey] = useState(resetKey);
  if (seenKey !== resetKey) {
    setSeenKey(resetKey);
    setFilters(noFilters);
  }
  return [filters, setFilters] as const;
}

/**
 * The open board. Memoized: while a refresh brings nothing new, none of its props change and it is not
 * rendered again. Every handler is stable and acts on the board shown here.
 */
export const BoardView = memo(function BoardView({
  board,
  busy,
  disabled,
  refreshDisabled,
  refreshing,
  resetKey,
  today,
  onRefresh,
  onSettings,
  onInvite,
  onAddCard,
  onAddColumn,
  onEditColumn,
  onEditCard,
  onMoveCard,
  onDropCard,
}: {
  board: Board;
  busy: boolean;
  disabled: boolean;
  refreshDisabled: boolean;
  refreshing: boolean;
  /** Changes when the person navigates; the filters start over. */
  resetKey: number;
  /** Today's date as YYYY-MM-DD, to mark overdue cards. */
  today: string;
  onRefresh: () => void;
  onSettings: () => void;
  onInvite: () => void;
  onAddCard: (column: Column) => void;
  onAddColumn: () => void;
  onEditColumn: (column: Column) => void;
  onEditCard: (card: Card) => void;
  onMoveCard: (card: Card, columnId: string) => void;
  onDropCard: (cardId: string, columnId: string) => void;
}) {
  const [{ query, priority, assignee }, setFilters] = useFilters(resetKey);
  const [dragColumn, setDragColumn] = useState('');
  const assignees = useMemo(
    () => [...new Set(board.cards.map((card) => card.assignee).filter(Boolean))].sort(),
    [board.cards],
  );
  // The cards each column shows, in order. Recomputed only when the board or a filter changes.
  const columnCards = useMemo(() => {
    const needle = query.toLowerCase();
    const matches = (card: Card) =>
      (priority === 'all' || card.priority === priority) &&
      (!assignee || card.assignee === assignee.slice('name:'.length)) &&
      (needle === '' ||
        `${card.title} ${card.description} ${card.assignee} ${card.labels.join(' ')}`
          .toLowerCase()
          .includes(needle));
    return board.columns.map((column) => sortedCards(board, column.id).filter(matches));
  }, [board, query, priority, assignee]);
  const filteredCount = columnCards.reduce((total, cards) => total + cards.length, 0);
  return (
    <>
      <section className="board-heading">
        <div>
          <p className="eyebrow">ROOM FOR GOOD IDEAS</p>
          <h1>{board.title}</h1>
          {board.description && <p className="board-description">{board.description}</p>}
          <div className="board-stats">
            <span>
              <Columns3 size={14} />
              {board.columns.length} columns
            </span>
            <span>
              {board.cards.length} {board.cards.length === 1 ? 'card' : 'cards'}
            </span>
            <span className="shared-label">
              <Users size={14} />
              Shared board
            </span>
          </div>
        </div>
        <div className="board-actions">
          <button type="button" className="button secondary" onClick={onSettings} disabled={busy}>
            <Settings2 size={16} />
            <span>Settings</span>
          </button>
          <button type="button" className="button primary" onClick={onInvite}>
            <Users size={16} />
            Invite people
          </button>
        </div>
      </section>
      <section className="board-toolbar" aria-label="Card filters">
        <div className="board-view">
          <Columns3 size={17} />
          Board
          <span />
        </div>
        <div className="filters">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="Search cards"
              value={query}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  query: event.target.value,
                }))
              }
              placeholder="Find a card…"
            />
          </label>
          <select
            aria-label="Filter priority"
            value={priority}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                priority: event.target.value,
              }))
            }
          >
            <option value="all">All priorities</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
          </select>
          <select
            aria-label="Filter assignee"
            value={assignee}
            onChange={(event) =>
              setFilters((current) => ({
                ...current,
                assignee: event.target.value,
              }))
            }
          >
            <option value="">Everyone</option>
            {assignees.map((name) => (
              <option key={name} value={`name:${name}`}>
                {name}
              </option>
            ))}
            <option value="name:">Unassigned</option>
          </select>
          <button
            type="button"
            className="icon-button"
            aria-label="Refresh boards"
            disabled={refreshDisabled}
            onClick={onRefresh}
          >
            <RefreshCw size={16} className={refreshing ? 'spin' : ''} />
          </button>
        </div>
      </section>
      {(query || priority !== 'all' || assignee !== '') && (
        <div className="filter-summary">
          Showing {filteredCount} of {board.cards.length} cards
          <button type="button" className="text-button" onClick={() => setFilters(noFilters)}>
            Clear filters
          </button>
        </div>
      )}
      <div className="pinboard-scroll">
        <div className="pinboard-columns">
          {board.columns.map((column, index) => (
            <ColumnView
              key={column.id}
              column={column}
              columns={board.columns}
              cards={columnCards[index]!}
              hasCards={
                columnCards[index]!.length > 0 ||
                board.cards.some((card) => card.columnId === column.id)
              }
              dropActive={dragColumn === column.id}
              disabled={disabled}
              canAddCard={board.cards.length < LIMITS.cards}
              today={today}
              onSettings={onEditColumn}
              onAddCard={onAddCard}
              onEditCard={onEditCard}
              onMoveCard={onMoveCard}
              onDropCard={onDropCard}
              onDragColumn={setDragColumn}
            />
          ))}
          <button
            type="button"
            className="add-column"
            disabled={disabled || board.columns.length >= LIMITS.columns}
            onClick={onAddColumn}
          >
            <Plus size={17} />
            Add column
          </button>
        </div>
      </div>
      <footer className="board-footer">
        <span>Small steps. Good progress.</span>
      </footer>
    </>
  );
});

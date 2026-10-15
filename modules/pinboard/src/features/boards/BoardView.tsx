import { memo, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Columns3, RefreshCw, Search, Settings2, Users } from 'lucide-react';
import type { Board, Card, CardDropTarget, CardFilters, Column } from '../../domain/boards/types';
import { activeCards, LIMITS } from '../../domain/boards/board';
import { cardFields, fieldVisible } from '../../domain/boards/fields';
import { ColumnView } from './ColumnView';

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
  filters,
  orderedCards,
  columnCards,
  filteredCount,
  onFiltersChange: setFilters,
  onClearFilters,
  today,
  onRefresh,
  onSettings,
  onInvite,
  onAddCard,
  onEditColumn,
  onEditCard,
  onMoveCard,
  onDropCard,
  onReorderCard,
}: {
  board: Board;
  busy: boolean;
  disabled: boolean;
  refreshDisabled: boolean;
  refreshing: boolean;
  filters: CardFilters;
  orderedCards: Card[][];
  columnCards: Card[][];
  filteredCount: number;
  onFiltersChange: Dispatch<SetStateAction<CardFilters>>;
  onClearFilters: () => void;
  /** Today's date as YYYY-MM-DD, to mark overdue cards. */
  today: string;
  onRefresh: () => void;
  onSettings: () => void;
  onInvite: () => void;
  onAddCard: (column: Column) => void;
  onEditColumn: (column: Column) => void;
  onEditCard: (card: Card) => void;
  onMoveCard: (card: Card, columnId: string) => void;
  onDropCard: (cardId: string, columnId: string, target?: CardDropTarget) => void;
  onReorderCard: (card: Card, direction: -1 | 1) => void;
}) {
  const { query, priority, assignee } = filters;
  const fields = cardFields(board);
  const activePriority = fieldVisible(fields, 'priority') ? priority : 'all';
  const activeAssignee = fieldVisible(fields, 'assignee') ? assignee : '';
  const [dragColumn, setDragColumn] = useState('');
  const assignees = useMemo(
    () =>
      [
        ...new Set(
          activeCards(board)
            .map((card) => card.assignee)
            .filter(Boolean),
        ),
      ].sort(),
    [board],
  );
  return (
    <>
      <section className="board-heading">
        <div>
          <h1>{board.title}</h1>
          {board.description && <p className="board-description">{board.description}</p>}
        </div>
        <div className="board-actions">
          <button
            type="button"
            className="button secondary"
            aria-label="Settings"
            title="Settings"
            onClick={onSettings}
            disabled={busy}
          >
            <Settings2 size={16} />
            <span>Settings</span>
          </button>
          <button
            type="button"
            className="button primary"
            aria-label="Invite people"
            title="Invite people"
            onClick={onInvite}
          >
            <Users size={16} />
            <span>Invite people</span>
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
          {fieldVisible(fields, 'priority') && (
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
          )}
          {fieldVisible(fields, 'assignee') && (
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
          )}
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
      {(query || activePriority !== 'all' || activeAssignee !== '') && (
        <div className="filter-summary">
          Showing {filteredCount} of{' '}
          {orderedCards.reduce((total, cards) => total + cards.length, 0)} cards
          <button type="button" className="text-button" onClick={onClearFilters}>
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
              fields={fields}
              cards={columnCards[index]!}
              firstCardId={orderedCards[index]![0]?.id}
              lastCardId={orderedCards[index]!.at(-1)?.id}
              hasCards={columnCards[index]!.length > 0 || orderedCards[index]!.length > 0}
              dropActive={dragColumn === column.id}
              disabled={disabled}
              canAddCard={board.cards.length < LIMITS.cards}
              today={today}
              onSettings={onEditColumn}
              onAddCard={onAddCard}
              onEditCard={onEditCard}
              onMoveCard={onMoveCard}
              onDropCard={onDropCard}
              onReorderCard={onReorderCard}
              onDragColumn={setDragColumn}
            />
          ))}
        </div>
      </div>
    </>
  );
});

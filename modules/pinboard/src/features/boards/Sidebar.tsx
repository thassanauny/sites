import { Plus } from 'lucide-react';
import type { Board, BoardSummary } from '../../domain/boards/types';
import { cardFields, fieldVisible } from '../../domain/boards/fields';
import { activeCards } from '../../domain/boards/board';

export function Sidebar({
  boards,
  activeId,
  currentBoard,
  visibleCardCount,
  showEmptyHint,
  disabled,
  onOpen,
  onCreate,
}: {
  boards: BoardSummary[];
  activeId?: string;
  currentBoard?: Board;
  visibleCardCount: number;
  showEmptyHint: boolean;
  disabled: boolean;
  onOpen: (board: BoardSummary) => void;
  onCreate: () => void;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const cards = currentBoard ? activeCards(currentBoard) : [];
  const showDueDates = currentBoard ? fieldVisible(cardFields(currentBoard), 'dueDate') : false;
  const columnCounts = new Map(currentBoard?.columns.map((column) => [column.id, 0]));
  let dueToday = 0;
  let overdue = 0;
  if (currentBoard) {
    for (const card of cards) {
      columnCounts.set(card.columnId, (columnCounts.get(card.columnId) ?? 0) + 1);
      if (showDueDates && card.dueDate === today) dueToday += 1;
      else if (showDueDates && card.dueDate && card.dueDate < today) overdue += 1;
    }
  }
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <span>YOUR BOARDS</span>
        <button
          type="button"
          className="icon-button"
          title="Create board"
          aria-label="Create board"
          onClick={onCreate}
          disabled={disabled}
        >
          <Plus size={17} />
        </button>
      </div>
      <nav className="board-nav" aria-label="Boards">
        {boards.map((item) => (
          <button
            type="button"
            key={item.id}
            className={`board-nav-item ${item.id === activeId ? 'active' : ''}`}
            onClick={() => onOpen(item)}
          >
            <span className="board-nav-dot" />
            <span>{item.title}</span>
            <span className="board-nav-count">{item.active_card_count}</span>
          </button>
        ))}
        {showEmptyHint && (
          <p className="sidebar-empty">
            Your next project
            <br />
            starts with a board.
          </p>
        )}
      </nav>
      <div className="sidebar-bottom">
        {currentBoard && (
          <section className="sidebar-overview" aria-label="Current board overview">
            <h2>At a glance</h2>
            <dl>
              <div>
                <dt>Columns</dt>
                <dd>{currentBoard.columns.length}</dd>
              </div>
              <div>
                <dt>Cards</dt>
                <dd>{cards.length}</dd>
              </div>
              {showDueDates && (
                <div>
                  <dt>Due today</dt>
                  <dd>{dueToday}</dd>
                </div>
              )}
              {showDueDates && (
                <div>
                  <dt>Overdue</dt>
                  <dd className={overdue ? 'overdue' : undefined}>{overdue}</dd>
                </div>
              )}
            </dl>
            <ul className="sidebar-column-counts" aria-label="Cards by column">
              {currentBoard.columns.map((column) => (
                <li key={column.id} className={`color-${column.color}`}>
                  <span className="column-dot" aria-hidden="true" />
                  <span className="sidebar-column-name" title={column.title}>
                    {column.title}
                  </span>
                  <strong>{columnCounts.get(column.id)}</strong>
                </li>
              ))}
            </ul>
            <div className="sidebar-board-meta">
              <p className="sidebar-visible-cards">
                Showing {visibleCardCount} of {cards.length} {cards.length === 1 ? 'card' : 'cards'}
              </p>
            </div>
          </section>
        )}
        <div className="sidebar-footer">
          {currentBoard && (
            <span className="footer-board-change">
              Last board change:{' '}
              <time dateTime={currentBoard.updated_at}>
                {new Date(currentBoard.updated_at).toLocaleString('en-US', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                  hour12: true,
                })}
              </time>
            </span>
          )}
        </div>
      </div>
    </aside>
  );
}

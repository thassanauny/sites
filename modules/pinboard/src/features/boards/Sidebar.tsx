import { Columns3, Plus } from 'lucide-react';
import type { Board } from '../../domain/boards/types';
import { cardFields, fieldVisible } from '../../domain/boards/fields';
import { activeCards } from '../../domain/boards/board';

export function Sidebar({
  boards,
  activeId,
  visibleCardCount,
  atHome,
  showEmptyHint,
  disabled,
  status,
  statusTitle,
  onHome,
  onOpen,
  onCreate,
}: {
  boards: Board[];
  activeId?: string;
  visibleCardCount: number;
  atHome: boolean;
  showEmptyHint: boolean;
  disabled: boolean;
  status: string;
  statusTitle?: string;
  onHome: () => void;
  onOpen: (board: Board) => void;
  onCreate: () => void;
}) {
  const today = new Date().toLocaleDateString('en-CA');
  const currentBoard = boards.find((board) => board.id === activeId);
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
      <button
        type="button"
        className="brand"
        onClick={onHome}
        aria-label="Open workspace"
        aria-current={atHome ? 'page' : undefined}
      >
        <span className="brand-mark">
          <Columns3 size={23} strokeWidth={2.5} />
        </span>
        <span>
          pinboard<span className="brand-dot">.</span>
        </span>
      </button>
      <p className="brand-subtitle">A place for your projects.</p>
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
            <span className="board-nav-count">{activeCards(item).length}</span>
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
          <span title={statusTitle}>{status}</span>
        </div>
      </div>
    </aside>
  );
}

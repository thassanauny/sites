import { Columns3, LayoutDashboard, Link, Plus, Users } from 'lucide-react';
import type { Board } from '../../domain/boards/types';

export function Sidebar({
  boards,
  activeId,
  atHome,
  showEmptyHint,
  disabled,
  status,
  statusTitle,
  version,
  onHome,
  onOpen,
  onCreate,
  onJoin,
}: {
  boards: Board[];
  activeId?: string;
  atHome: boolean;
  showEmptyHint: boolean;
  disabled: boolean;
  status: string;
  statusTitle?: string;
  version: string;
  onHome: () => void;
  onOpen: (board: Board) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={onHome}>
        <span className="brand-mark">
          <Columns3 size={23} strokeWidth={2.5} />
        </span>
        <span>
          pinboard<span className="brand-dot">.</span>
        </span>
      </button>
      <p className="brand-subtitle">A place for your projects.</p>
      <button
        type="button"
        className={`nav-home ${atHome ? 'active' : ''}`}
        aria-current={atHome ? 'page' : undefined}
        onClick={onHome}
      >
        <LayoutDashboard size={18} />
        Workspace
      </button>
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
            <span className="board-nav-count">{item.cards.length}</span>
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
        <div className="together-note">
          <Users size={21} />
          <strong>Made for small projects.</strong>
          <p>
            Keep track on your own,
            <br />
            with a partner, or with a few people.
          </p>
        </div>
        <button type="button" className="button join-button" onClick={onJoin} disabled={disabled}>
          <Link size={16} />
          Join with a code
        </button>
        <div className="sidebar-footer">
          <span title={statusTitle}>{status}</span>
          <span>v{version}</span>
        </div>
      </div>
    </aside>
  );
}

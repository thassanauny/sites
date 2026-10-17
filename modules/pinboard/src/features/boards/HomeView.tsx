import { ArrowUpRight, CalendarDays, Check, Link, LoaderCircle, Plus } from 'lucide-react';
import type { BoardSummary } from '../../domain/boards/types';

export function HomeView({
  boards,
  loaded,
  disabled,
  onCreate,
  onJoin,
  onOpen,
}: {
  boards: BoardSummary[];
  loaded: boolean;
  disabled: boolean;
  onCreate: () => void;
  onJoin: () => void;
  onOpen: (board: BoardSummary) => void;
}) {
  return (
    <section className="home">
      <div className="home-heading">
        <div>
          <p className="eyebrow">SIMPLE KANBAN FOR YOUR EVERYDAY PROJECTS</p>
          <h1>
            Your projects,
            <br />
            <em>in view.</em>
          </h1>
          <p>
            Keep track of what’s next and what’s done.
            <br />
            Work on your own, with a partner, or with a few people.
          </p>
        </div>
        <div className="home-actions">
          <button type="button" className="button primary" disabled={disabled} onClick={onCreate}>
            <Plus size={18} />
            Create a board
          </button>
          <button type="button" className="button secondary" disabled={disabled} onClick={onJoin}>
            <Link size={17} />
            Join a board
          </button>
        </div>
      </div>
      {!loaded ? (
        <div className="loading">
          <LoaderCircle size={24} className="spin" />
          Finding your boards…
        </div>
      ) : boards.length > 0 ? (
        <>
          <div className="section-heading">
            <h2>
              Your boards <span>{boards.length}</span>
            </h2>
          </div>
          <div className="board-grid">
            {boards.map((item) => (
              <button
                type="button"
                key={item.id}
                className="board-preview"
                aria-label={`Open ${item.title}`}
                title={item.description || undefined}
                onClick={() => onOpen(item)}
              >
                <div className="preview-art" aria-hidden="true">
                  {item.columns.slice(0, 4).map((column) => (
                    <div className={`preview-column color-${column.color}`} key={column.id}>
                      <span />
                      <i />
                      <i className="short" />
                    </div>
                  ))}
                </div>
                <div className="preview-info">
                  <h3>
                    <span>{item.title}</span>
                    <ArrowUpRight size={16} />
                  </h3>
                  <p>
                    {item.active_card_count} cards · {item.columns.length} columns
                  </p>
                  <span className="preview-access">
                    {item.localPending ? 'Waiting to sync' : 'Shared board'}
                  </span>
                </div>
                <div className="preview-updated">
                  <span>
                    Updated{' '}
                    <time dateTime={item.updated_at}>
                      {new Date(item.updated_at).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </time>
                  </span>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <WelcomePanel />
      )}
    </section>
  );
}

function WelcomePanel() {
  return (
    <div className="welcome-panel">
      <div className="welcome-copy">
        <span className="little-label">LESS SCATTER. MORE CLARITY.</span>
        <h2>
          From “someday”
          <br />
          to “look at that.”
        </h2>
        <p>
          Give your tasks a place to land.
          <br />A board, a few cards, and you’re on your way.
        </p>
        <div className="welcome-check">
          <Check size={16} />
          Simple boards. Shared progress.
        </div>
      </div>
      <div className="illustration" aria-hidden="true">
        <div className="mini-column">
          <div className="mini-title">
            <i />
            To do<span>2</span>
          </div>
          <div className="mini-card">
            <b className="mini-tag">IDEAS</b>
            <strong>The next good thing</strong>
            <span className="mini-line" />
            <span className="mini-avatar">A</span>
          </div>
          <div className="mini-card small">
            <strong>Make a little space</strong>
            <span className="mini-line" />
          </div>
        </div>
        <div className="mini-column">
          <div className="mini-title">
            <i className="amber" />
            In progress<span>1</span>
          </div>
          <div className="mini-card raised">
            <b className="mini-tag peach">THIS WEEK</b>
            <strong>Bring it to life</strong>
            <span className="mini-line" />
            <span className="mini-line short" />
            <div className="mini-bottom">
              <span className="mini-avatar pink">J</span>
              <CalendarDays size={14} />
            </div>
          </div>
          <span className="mini-add">
            <Plus size={14} />
            Add a card
          </span>
        </div>
        <div className="mini-column">
          <div className="mini-title">
            <i className="green" />
            Done<span>1</span>
          </div>
          <div className="mini-card">
            <span className="done-icon">
              <Check size={17} />
            </span>
            <strong>A little victory</strong>
            <span className="mini-line" />
          </div>
        </div>
      </div>
    </div>
  );
}

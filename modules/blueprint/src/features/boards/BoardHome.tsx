import { useEffect, useRef } from "react";
import {
  ArrowUpRight,
  Layers3,
  Plus,
  Users,
} from "lucide-react";
import type { Board } from "../../domain/boards/types";
import { BoardPreview } from "./BoardPreview";
export function BoardHome({
  boards,
  activeId,
  onOpen,
  onNew,
  onJoin,
  notice,
  onSettings,
  onRetry,
}: {
  boards: Board[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onJoin: () => void;
  notice?: string;
  onSettings: () => void;
  onRetry?: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="board-home"
      aria-label="All boards"
    >
      <div className="home-content">
        <div className="home-intro">
          <div>
            <p className="home-eyebrow">
              VISUAL SYSTEM DESIGN FOR YOUR BIG IDEAS
            </p>
            <h1 ref={heading} tabIndex={-1}>
              Your systems, <em>at a glance.</em>
            </h1>
            <p>
              Every architecture, all in one place. Pick up where you left off.
            </p>
          </div>
          <div className="home-actions">
            <button className="button primary" onClick={onNew}>
              <Plus size={17} /> Create a board
            </button>
            <button className="button secondary" onClick={onJoin}>
              <Users size={15} /> Join a board
            </button>
          </div>
        </div>
        <div className="home-tools">
          <div className="home-board-count">
            <strong>Your boards</strong>
            <span>{boards.length}</span>
          </div>

        </div>
        {notice && (
          <div className="home-notice" role="alert">
            <p>{notice}</p>
            <button className="button secondary" onClick={onRetry || onSettings}>
              {onRetry ? "Retry opening" : "Open Settings"}
            </button>
          </div>
        )}
        <div className="board-grid">
          {boards.map((board) => {
            const shared = board.revision > 0;
            return (
              <article
                className={`board-card ${board.id === activeId ? "current" : ""}`}
                key={board.id}
              >
                <button
                  className="board-open"
                  aria-label={`Open ${board.title}`}
                  onClick={() => onOpen(board.id)}
                >
                  <BoardPreview board={board} />
                  <div className="board-card-info">
                    <div>
                      <h2>{board.title}</h2>
                      <ArrowUpRight size={16} />
                    </div>
                    <p>
                      {board.nodes.length} components · {board.edges.length}{" "}
                      connections
                    </p>
                    <span className="board-access">
                      {shared ? "Shared board" : "Recovery copy · waiting to save online"}
                    </span>
                  </div>
                </button>
                <div className="board-card-footer">
                  <span>
                    Updated{" "}
                    {new Date(board.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>

                </div>
              </article>
            );
          })}
        </div>
        {!boards.length && (
          <div className="home-empty">
            <Layers3 size={24} />
            <h2>No boards yet</h2>
            <p>Create a board or join one with an invitation.</p>
          </div>
        )}
      </div>
    </main>
  );
}

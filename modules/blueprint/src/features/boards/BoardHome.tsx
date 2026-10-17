import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Layers3,
  Plus,
  Trash2,
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
  onRemove,
  notice,
  onSettings,
  onRetry,
}: {
  boards: Board[];
  activeId: string;
  onOpen: (id: string) => void;
  onNew: () => void;
  onJoin: () => void;
  onRemove: (id: string) => Promise<void>;
  notice?: string;
  onSettings: () => void;
  onRetry?: () => void;
}) {
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
              <Layers3 size={14} /> YOUR WORKSPACE
            </p>
            <h1 ref={heading} tabIndex={-1}>
              A home for your big ideas.
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
        {error && (
          <p className="form-message error" role="alert">
            {error}
          </p>
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
                {removeId === board.id && shared && (
                  <div className="board-remove-note">
                    <p>Keep this invitation to rejoin:</p>
                    <code>{board.inviteCode}</code>
                    <p>
                      This only hides the board on this device. Shared work and
                      other devices are unaffected.
                    </p>
                  </div>
                )}
                <div className="board-card-footer">
                  <span>
                    Updated{" "}
                    {new Date(board.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                  {removeId === board.id ? (
                    <div className="board-remove-confirm">
                      <button
                        className="danger"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setError("");
                          try {
                            await onRemove(board.id);
                            setRemoveId(null);
                          } catch (error) {
                            setError(
                              error instanceof Error
                                ? error.message
                                : "Could not remove this board. Check browser storage and try again.",
                            );
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? "Working…" : shared ? "Remove?" : "Delete?"}
                      </button>
                      <button disabled={busy} onClick={() => setRemoveId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      className="icon-button"
                      aria-label={
                        shared
                          ? `Remove ${board.title} from this device`
                          : `Delete local draft ${board.title}`
                      }
                      onClick={() => setRemoveId(board.id)}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
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
        <p className="home-footnote">
          Your own boards and boards you’ve joined appear here.
        </p>
      </div>
    </main>
  );
}

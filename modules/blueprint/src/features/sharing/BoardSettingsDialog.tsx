import { Download, Laptop, RefreshCw, Share2, Users } from "lucide-react";
import { Modal } from "../../ui/Modal";
import type { useAuth } from "../../infrastructure/auth/useAuth";
import type { useCloudBoards } from "../../application/useCloudBoards";
import type { Board } from "../../domain/boards/types";
import { APP_VERSION } from "../../ui/version";

export function BoardSettingsDialog({
  auth,
  cloud,
  board,
  exportJson,
  onClose,
  onShare,
}: {
  auth: ReturnType<typeof useAuth>;
  cloud: ReturnType<typeof useCloudBoards>;
  board: Board;
  exportJson: () => void;
  onClose: () => void;
  onShare: () => void;
}) {
  return (
    <Modal
      title="Board settings"
      subtitle="Share your architecture and keep your work safe."
      onClose={onClose}
    >
      <div className="access-summary">
        <span className="node-icon tone-green">
          <Users size={23} />
        </span>
        <div>
          <strong>
            {board.revision ? "A shared space for your ideas" : "Local draft"}
          </strong>
          <p>
            {board.revision
              ? "Everyone who joins with the invitation can edit this board."
              : "Your work saves in this browser. Connect to share it."}
          </p>
        </div>
      </div>
      {board.revision > 0 && (
        <section className="settings-section device-guide">
          <h3>
            <Laptop size={16} /> Use this board on another computer
          </h3>
          <ol>
            <li>
              Copy the invitation code or link from <strong>Share</strong>.
            </li>
            <li>
              On the other computer, open Blueprint and choose{" "}
              <strong>Join board</strong>. Enter the invitation and start
              editing.
            </li>
          </ol>
          {["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) && (
            <p className="subtle-note">
              This local address works only on this computer. On the other
              computer, use the published Blueprint site and enter the invitation
              code.
            </p>
          )}
          <p className="subtle-note">
            Keep the invitation to rejoin after clearing browser data. Anyone
            with it can join and edit.
          </p>
          <button className="button secondary" onClick={onShare}>
            <Share2 size={14} /> Open invitation
          </button>
        </section>
      )}
      {!auth.configured && (
        <div className="cloud-config-help">
          <strong>Enable Supabase sharing</strong>
          <p>
            Blueprint uses the collection’s shared public Supabase settings. Apply
            the app’s database migrations to enable sharing.
          </p>
          <p>
            Standalone configuration uses <code>VITE_SUPABASE_URL</code> and{" "}
            <code>VITE_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
      )}
      {auth.authError && (
        <div className="form-message error" role="alert">
          <p>{auth.authError}</p>
          <button className="button secondary" onClick={auth.retrySession}>
            Retry device session
          </button>
        </div>
      )}
      {cloud.error && (
        <div
          className={
            cloud.status === "conflict"
              ? "cloud-conflict"
              : "form-message error"
          }
          role="alert"
        >
          <p>{cloud.error}</p>
          {cloud.status === "conflict" ? (
            <button
              className="button secondary"
              onClick={() => {
                cloud.saveAsCopy();
                onClose();
              }}
            >
              Save my changes as a new board
            </button>
          ) : (
            <button className="button secondary" onClick={cloud.retry}>
              <RefreshCw size={14} /> Retry cloud connection
            </button>
          )}
        </div>
      )}
      <div className="settings-actions backup-action">
        <button className="button secondary" onClick={exportJson}>
          <Download size={14} /> Export a backup
        </button>
      </div>
      <p className="auth-footer">
        Blueprint {APP_VERSION} · Device-based access, no email required.
        <br />
        Keep your invitation code before clearing browser storage.
      </p>
    </Modal>
  );
}

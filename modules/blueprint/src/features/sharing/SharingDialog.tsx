import { useEffect, useRef, useState } from "react";
import { ArrowRight, Copy, Link2, LoaderCircle, Users } from "lucide-react";
import { Modal } from "../../ui/Modal";
import { invitationLink } from "../../domain/sharing/invitations";
import type { Board } from "../../domain/boards/types";
import type { useCloudBoards } from "../../application/useCloudBoards";

export function SharingDialog({
  mode,
  board,
  cloud,
  initialCode,
  onClose,
  onSettings,
  onJoined,
}: {
  mode: "join" | "share";
  board: Board;
  cloud: ReturnType<typeof useCloudBoards>;
  initialCode: string;
  onClose: () => void;
  onSettings: () => void;
  onJoined: (code: string, rejoined: boolean) => void;
}) {
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(label);
      setError("");
    } catch {
      setError(
        "Could not copy automatically. Select the code or link and copy it.",
      );
    }
  };
  return (
    <Modal
      title={mode === "join" ? "Join a board" : "Invite people to your board"}
      subtitle={
        mode === "join"
          ? "Join with an invitation and start editing."
          : "A shared space to design the bigger picture."
      }
      onClose={onClose}
    >
      <div className="sharing-banner">
        <Users size={18} />
        <p>
          Anyone with this invitation can <strong>join and edit</strong>. Share
          it with your collaborators.
        </p>
      </div>
      {mode === "join" ? (
        <form
          className="join-form"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const joined = await cloud.joinBoard(code, true, () => active.current);
              if (!joined || !active.current) return;
              onClose();
              onJoined(joined.inviteCode!, joined.wasRemoved);
            } catch (error) {
              setError(
                error instanceof Error
                  ? error.message
                  : "Could not join this board.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Invitation code or link
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Paste the board invitation"
              autoComplete="off"
              required
            />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <Users size={15} />
            )}
            Join board
            <ArrowRight size={14} />
          </button>
        </form>
      ) : board.inviteCode ? (
        <div className="share-fields">
          <label className="field">
            Invitation code
            <input
              value={board.inviteCode}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </label>
          <div className="settings-actions">
            <button
              className="button secondary"
              onClick={() => copy(board.inviteCode!, "Invitation code copied.")}
            >
              <Copy size={14} />
              Copy code
            </button>
            <button
              className="button primary"
              onClick={() =>
                copy(
                  invitationLink(board.inviteCode!, location.href),
                  "Invitation link copied.",
                )
              }
            >
              <Link2 size={14} />
              Copy invitation link
            </button>
          </div>
          <label className="field invitation-link-field">
            Invitation link
            <input
              value={invitationLink(board.inviteCode, location.href)}
              readOnly
              onFocus={(event) => event.target.select()}
            />
          </label>
        </div>
      ) : (
        <div className="cloud-config-help">
          <strong>
            {cloud.status === "saving" || cloud.status === "loading"
              ? "Getting this board ready to share…"
              : "Save this board to Supabase first"}
          </strong>
          <p>
            {cloud.error ||
              "Invitations become available after the board is saved online."}
          </p>
          <button className="button secondary" onClick={onSettings}>
            Open Settings
          </button>
        </div>
      )}
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="form-message" role="status">
          {message}
        </p>
      )}
      <p className="auth-footer">
        Anyone with this invitation can join, edit and forward it.
        <br />
        Keep the code to recover access on another device.
      </p>
    </Modal>
  );
}

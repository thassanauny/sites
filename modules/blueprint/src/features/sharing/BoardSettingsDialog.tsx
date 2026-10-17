import { useState } from "react";
import { Download, Laptop, RefreshCw, LogOut, Copy } from "lucide-react";
import { Modal } from "../../ui/Modal";
import type { useAuth } from "../../infrastructure/auth/useAuth";
import type { useCloudBoards } from "../../application/useCloudBoards";
import type { Board } from "../../domain/boards/types";

export function BoardSettingsDialog({
  auth,
  cloud,
  board,
  exportPng,
  isExporting,
  onClose,
  onRemove,
  onDetailsChange,
  readOnly = false,
}: {
  auth: ReturnType<typeof useAuth>;
  cloud: ReturnType<typeof useCloudBoards>;
  board: Board;
  exportPng?: () => Promise<void>;
  isExporting: boolean;
  onClose: () => void;
  onRemove?: () => Promise<void>;
  onDetailsChange?: (patch: Partial<Pick<Board, "title" | "description">>) => void;
  readOnly?: boolean;
}) {
  const [confirmForce, setConfirmForce] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [forceError, setForceError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const close = () => {
    if (removing || forcing) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest('.board-settings-popup')) active.blur();
    onClose();
  };
  return (
    <Modal
      title="Board settings"
      className="board-settings-popup"
      onClose={close}
    >
      {confirmRemove ? <div className="settings-remove-confirm">
        <p>Remove <strong>{board.title}</strong> from this device? The shared board and everyone’s access stay intact.</p>
        <p>Keep this invitation code to join again:</p>
        <label className="field">Invitation code<input readOnly value={board.inviteCode} onFocus={event => event.target.select()} /></label>
        <p>Your local recovery copy is kept.</p>
        {removeError && <p className="form-message error" role="alert">{removeError}</p>}
        <div className="blueprint-settings-footer">
          <button className="button secondary" autoFocus disabled={removing} onClick={() => setConfirmRemove(false)}>Keep on this device</button>
          <button className="button danger" disabled={removing} onClick={async () => {
            setRemoving(true);
            setRemoveError("");
            try { await onRemove?.(); } catch (error) {
              setRemoveError(error instanceof Error ? error.message : "Could not remove this board. Try again.");
            } finally { setRemoving(false); }
          }}>{removing ? "Removing…" : "Remove from this device"}</button>
        </div>
      </div> : <>
      <div className="blueprint-settings-grid">
      {onDetailsChange && <section className="blueprint-settings-section board-details-settings">
        <h3>Board details</h3>
        <label className="field">Board name<input key={`${board.id}-title-${board.title}`} defaultValue={board.title} readOnly={readOnly} maxLength={120} onBlur={event => {
          const title = event.target.value.trim() || 'Untitled architecture';
          if (title !== board.title) onDetailsChange({ title });
        }} /></label>
        <label className="field">Description<textarea key={`${board.id}-description-${board.description}`} defaultValue={board.description} readOnly={readOnly} maxLength={4000} rows={4} placeholder="A few details go a long way…" onBlur={event => {
          if (event.target.value !== board.description) onDetailsChange({ description: event.target.value });
        }} /></label>
        <div className="settings-board-counts"><span>{board.nodes.filter(node => !['note','text','boundary'].includes(node.data.kind)).length} components</span><span>{board.edges.length} connections</span></div>
      </section>}
      <div className="blueprint-settings-side">
      <section className="blueprint-settings-section"><h3>Board actions</h3>
      <div className="settings-shortcuts">
        {exportPng && <button className="settings-shortcut" disabled={isExporting || !board.nodes.length} onClick={() => void exportPng()} aria-label={isExporting ? "Exporting PNG…" : "Export as PNG"}>
          <Download size={16} /><span><strong>{isExporting ? "Exporting PNG…" : "Export as PNG"}</strong><small>Download an image of the diagram</small></span>
        </button>}
      </div>
      </section>

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
      <section className="blueprint-settings-section">
        <h3>Sync and recovery</h3>
        {cloud.error && <p className="form-message error" role="alert">{cloud.error.includes("This board changed elsewhere or is no longer accessible.") ? "Cloud version changed or access was lost. Your local changes are safe." : cloud.error}</p>}
        <div className="force-sync-actions">
          {confirmForce ? <>
            <p>Replace the cloud board with your local version? Changes saved from other tabs or devices will be overwritten.</p>
            <button className="button primary" disabled={forcing || cloud.status === "saving"} onClick={async () => {
              setForcing(true);
              setForceError("");
              try { await cloud.forceSync(); setConfirmForce(false); }
              catch (error) { setForceError(error instanceof Error ? error.message : "Could not force sync. Try again."); }
              finally { setForcing(false); }
            }}>{forcing ? "Syncing…" : "Replace cloud board"}</button>
            <button className="button secondary" disabled={forcing} onClick={() => { setConfirmForce(false); setForceError(""); }}>Cancel</button>
          </> : <button className="button secondary settings-shortcut settings-action-button" disabled={readOnly || cloud.status === "saving"} onClick={() => setConfirmForce(true)}><RefreshCw size={16} /> Force sync my changes</button>}
          {forceError && <p role="alert">{forceError}</p>}
        </div>
        <button className="button secondary settings-shortcut settings-action-button" disabled={forcing || cloud.status === "saving"} onClick={() => { cloud.saveAsCopy(); onClose(); }}>
          <Copy size={16} /> Save my changes as a new board
        </button>
        {cloud.error && cloud.status !== "conflict" && <button className="button secondary" disabled={forcing} onClick={cloud.retry}>
          <RefreshCw size={16} /> Retry cloud connection
        </button>}
      </section>

      </div>
      {board.revision > 0 && <section className="settings-device-help" aria-label="Access on another device">
        <h3><Laptop size={15} /> Access on another device</h3>
        <p>Use <strong>Join a board</strong> with your invitation code on another device. Anyone with the invitation can edit. Keep it for recovery.</p>
        {["127.0.0.1", "localhost", "[::1]"].includes(location.hostname) && <p>Use the published Blueprint site on other devices.</p>}
      </section>}
      {onRemove && board.revision > 0 && <section className="blueprint-settings-section settings-device-section">
        <h3>On this device</h3>
        <p className="settings-hint">Hide this board here. Shared work and access stay intact.</p>
        <button className="settings-shortcut danger" onClick={() => setConfirmRemove(true)}>
          <LogOut size={16} /><span><strong>Remove from this device</strong></span>
        </button>
      </section>}
      </div>
      <div className="blueprint-settings-footer"><span className="settings-save-hint">{cloud.boardConflict ? "Your local changes are kept on this device." : readOnly ? "Reconnect to edit board details." : cloud.status === "saving" ? "Saving changes…" : "Changes save automatically."}</span><button className="button secondary" onClick={close}>Close</button></div>
      </>}
    </Modal>
  );
}

import { useEffect, useId, useRef, useState } from "react";
import { Download, Laptop, RefreshCw, LogOut, Copy, X } from "lucide-react";
import { Modal } from "../../ui/Modal";
import { ComponentIcon } from "../../ui/ComponentIcon";
import type { useAuth } from "../../infrastructure/auth/useAuth";
import type { useCloudBoards } from "../../application/useCloudBoards";
import { componentIconSets, componentKinds, type Board } from "../../domain/boards/types";
import { componentMeta } from "../../domain/boards/components";
import { boardContent } from "../../domain/boards/codec";
import { colorDepth } from "../../domain/boards/appearance";
import { diagramAppearance } from "../../ui/diagramAppearance";

export function BoardSettingsDialog({
  auth,
  cloud,
  board,
  exportPng,
  isExporting,
  onClose,
  onRemove,
  onDetailsChange,
  onSave,
  readOnly = false,
}: {
  auth: ReturnType<typeof useAuth>;
  cloud: ReturnType<typeof useCloudBoards>;
  board: Board;
  exportPng?: () => Promise<void>;
  isExporting: boolean;
  onClose: () => void;
  onRemove?: () => Promise<void>;
  onDetailsChange?: (patch: Partial<Pick<Board, "title" | "description" | "iconStyle" | "colorIntensity">>, remember?: boolean) => void;
  onSave?: () => Promise<void>;
  readOnly?: boolean;
}) {
  const [confirmForce, setConfirmForce] = useState(false);
  const [forcing, setForcing] = useState(false);
  const [forceError, setForceError] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const [saving, setSaving] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const saveStarted = useRef(false);
  const iconPreviewId = useId();
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewToggle = useRef<HTMLButtonElement>(null);
  const closePreview = () => { setPreviewOpen(false); previewToggle.current?.focus({ preventScroll: true }); };
  const intensityId = useId();
  const [draft, setDraft] = useState({ title: board.title, description: board.description, iconStyle: board.iconStyle, colorIntensity: board.colorIntensity });
  const initialDraft = useRef(draft);
  const patchDraft = (patch: Partial<typeof draft>) => setDraft(current => ({ ...current, ...patch }));
  const depth = colorDepth(draft.colorIntensity);
  const connectionPreview = diagramAppearance(draft.colorIntensity).connection;
  const selectedIconSet = componentIconSets.find(({ id }) => id === draft.iconStyle) ?? componentIconSets[0];
  useEffect(() => {
    if (!saving) { saveStarted.current = false; setLocalSaved(false); return; }
    if (!saveStarted.current) {
      saveStarted.current = true;
      void Promise.resolve().then(() => onSave?.()).then(() => setLocalSaved(true), error => {
        setSaveError(error instanceof Error ? error.message : "Could not save changes. Try again.");
        setSaving(false);
      });
    }
    if (!localSaved) return;
    if (cloud.boardConflict || cloud.status === "error") {
      setSaveError(cloud.boardConflict
        ? "Your changes are kept on this device. Resolve the cloud conflict before saving online."
        : cloud.error || "Could not save online. Your changes are kept on this device.");
      setSaving(false);
    } else if (!auth.user || !navigator.onLine || board.cloudSavedContent === boardContent(board)) {
      setSaving(false);
      onClose();
    }
  }, [saving, localSaved, onSave, board, cloud.boardConflict, cloud.status, cloud.error, auth.user, onClose]);
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
        <label className="field">Board name<input value={draft.title} readOnly={readOnly || saving} maxLength={120} onChange={event => patchDraft({ title: event.target.value })} /></label>
        <label className="field">Description<textarea value={draft.description} readOnly={readOnly || saving} maxLength={4000} rows={2} placeholder="A few details go a long way…" onChange={event => patchDraft({ description: event.target.value })} /></label>
        <div className="settings-board-counts"><span>{board.nodes.filter(node => !['note','text','boundary','swimlane'].includes(node.data.kind)).length} components</span><span>{board.edges.length} connections</span></div>
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
            the app’s current database schema to enable sharing.
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
      {onDetailsChange && <section className="blueprint-settings-section board-appearance-settings" role="group" aria-label="Default icon set" style={diagramAppearance(draft.colorIntensity).variables} onKeyDown={event => {
        if (event.key === "Escape" && previewOpen) { event.preventDefault(); event.stopPropagation(); closePreview(); }
      }}>
        <h3>Default icon set</h3>
        <div className="icon-style-options">
          {componentIconSets.map(({ id: iconStyle, label }) => (
            <button
              type="button"
              key={iconStyle}
              disabled={readOnly || saving}
              aria-pressed={selectedIconSet.id === iconStyle}
              onClick={() => {
                if (selectedIconSet.id !== iconStyle)
                  patchDraft({ iconStyle });
              }}
            >
              <span className="icon-style-preview">
                {(["client", "service", "database"] as const).map((kind) => (
                  <ComponentIcon key={kind} kind={kind} iconStyle={iconStyle} size={23} />
                ))}
              </span>
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="icon-preview-controls"><p>Applies to all components on this board.</p><button ref={previewToggle} type="button" className="button secondary" aria-expanded={previewOpen} aria-controls={iconPreviewId} onClick={() => setPreviewOpen(open => !open)}>{previewOpen ? "Hide icon preview" : "Preview all icons"}</button></div>
        {previewOpen && <div id={iconPreviewId} className="icon-set-preview-inline" role="region" aria-label={`${selectedIconSet.label} icon preview`}>
          <div className="icon-set-preview-header">
            <div><h4>{selectedIconSet.label}</h4><p>All {componentKinds.length} component icons · {depth}% intensity</p></div>
            <button type="button" className="icon-button" aria-label="Close icon preview" onClick={closePreview}><X size={17} /></button>
          </div>
          <ul className="icon-set-preview-grid" aria-label="Selected icon set preview">
            {componentKinds.map(kind => (
              <li key={kind} className={`tone-${componentMeta[kind].tone}`}>
                <span className="node-icon"><ComponentIcon kind={kind} iconStyle={selectedIconSet.id} size={28} /></span>
                <span>{componentMeta[kind].label}</span>
              </li>
            ))}
          </ul>
        </div>}
      </section>}
      {onDetailsChange && <section className="blueprint-settings-section board-color-settings" role="group" aria-label="Color intensity" style={diagramAppearance(draft.colorIntensity).variables}>
        <div className="color-intensity-heading">
          <h3><label htmlFor={intensityId}>Color intensity</label></h3>
          <output htmlFor={intensityId}>{depth}%</output>
        </div>
        <input id={intensityId} type="range" min={0} max={100} step={1} value={depth}
          aria-valuetext={`${depth}%${depth === 0 ? " · Soft" : depth === 100 ? " · Deep" : ""}`}
          disabled={readOnly || saving}
          onChange={event => patchDraft({ colorIntensity: Number(event.target.value) })} />
        <div className="color-intensity-scale" aria-hidden="true"><span>Soft</span><span>Deep</span></div>
        <div className="color-intensity-preview" role="img" aria-label={`Diagram preview at ${depth}% color intensity`}>
          {(["service", "queue", "database"] as const).map((kind, index) => (
            <div className="color-preview-step" key={kind}>
              {index > 0 && <svg className="color-preview-connection" viewBox="0 0 36 20" aria-hidden="true">
                <path d="M1 10H29" fill="none" stroke={connectionPreview.color} strokeWidth={connectionPreview.width} />
                <path d="m26 5 7 5-7 5Z" fill={connectionPreview.color} />
              </svg>}
              <span className={`color-intensity-chip tone-${componentMeta[kind].tone}`}>
                <span className="node-icon"><ComponentIcon kind={kind} iconStyle={selectedIconSet.id} size={20} /></span>
                <span>{componentMeta[kind].label}</span>
              </span>
            </div>
          ))}
        </div>
        <p>Live preview · Applies to components, borders and connections on this board.</p>
      </section>}
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
      {saveError && <p className="form-message error" role="alert">{saveError}</p>}
      <div className="blueprint-settings-footer">
        <span className="settings-save-hint">{cloud.boardConflict ? "Your local changes are kept on this device." : readOnly ? "Reconnect to edit board details." : saving || cloud.status === "saving" ? "Saving changes…" : ""}</span>
        <div className="settings-footer-actions">
          <button className="button secondary" onClick={close}>Close</button>
          {onSave && <button className="button primary" disabled={readOnly || saving || removing || forcing} onClick={() => {
            const active = document.activeElement;
            if (active instanceof HTMLElement) active.blur();
            setSaveError("");
            const patch: Partial<typeof draft> = {};
            if (draft.title !== initialDraft.current.title) patch.title = draft.title.trim() || "Untitled architecture";
            if (draft.description !== initialDraft.current.description) patch.description = draft.description;
            if (draft.iconStyle !== initialDraft.current.iconStyle) patch.iconStyle = draft.iconStyle;
            if (draft.colorIntensity !== initialDraft.current.colorIntensity) patch.colorIntensity = draft.colorIntensity;
            if (Object.keys(patch).length) onDetailsChange?.(patch);
            setSaving(true);
          }}>{saving ? "Saving…" : "Save changes"}</button>}
        </div>
      </div>
      </>}
    </Modal>
  );
}

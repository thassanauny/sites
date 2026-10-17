import { CheckCheck, LockKeyhole, LoaderCircle, X } from "lucide-react";
import { BoardHome } from "../features/boards/BoardHome";
import { SharingDialog } from "../features/sharing/SharingDialog";
import { Modal } from "../ui/Modal";
import { BoardSettingsDialog } from "../features/sharing/BoardSettingsDialog";
import { useAuth } from "../infrastructure/auth/useAuth";
import { APP_VERSION } from "../ui/version";
import { Logo } from "../ui/Logo";
import { useWorkspaceController } from "./useWorkspaceController";
import { TemplateCards } from "../features/boards/TemplateCards";
import { WorkspaceHeader } from "../features/editor/WorkspaceHeader";
import { ComponentPalette } from "../features/editor/ComponentPalette";
import { DiagramCanvas } from "../features/editor/DiagramCanvas";
import { PropertiesPanel } from "../features/editor/PropertiesPanel";
const shortcutRows = [
  ["Select tool", "V"],
  ["Pan tool", "H / Space"],
  ["Connect tool", "C"],
  ["Add sticky note", "N"],
  ["Add text", "T"],
  ["Undo", "⌘ / Ctrl Z"],
  ["Redo", "⌘ / Ctrl ⇧ Z"],
  ["Duplicate selection", "⌘ / Ctrl D"],
  ["Delete selection", "Delete / ⌫"],
  ["Select all", "⌘ / Ctrl A"],
  ["Fit to screen", "Shift 1"],
];

export default function App() {
  const auth = useAuth();
  if (auth.checking)
    return (
      <div className="app-loading">
        <Logo />
        <span>
          <LoaderCircle className="spin" size={17} />
          Opening your workspace…
        </span>
      </div>
    );
  return <Workspace key={auth.user?.id || "local"} auth={auth} />;
}

function Workspace({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const controller = useWorkspaceController(auth);
  const {
    workspace,
    cloud,
    board,
    readOnly,
    invitationInput,
    setInvitationInput,
    modal,
    setModal,
    showInspector,
    toast,
    setToast,
    home,
    routeError,
    retryBoardLink,
    showEditor,
    showHome,
    exportPng,
    isExporting,
    creating,
    openBoard,
    newBoard,
  } = controller;
  return (
    <div className="app-shell">
      <button
        type="button"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </button>
      <WorkspaceHeader controller={controller} />

      {home ? (
        <BoardHome
          boards={workspace.visibleBoards}
          activeId={board.id}
          notice={routeError || cloud.error || auth.authError || undefined}
          onRetry={routeError ? retryBoardLink : undefined}
          onSettings={() => setModal("cloud")}
          onOpen={openBoard}
          onNew={() => setModal("templates")}
          onJoin={() => {
            setInvitationInput("");
            setModal("join");
          }}
          onRemove={async (id) => {
            if (cloud.status === "saving")
              throw new Error("Wait for saving to finish, then try again.");
            await workspace.removeFromDevice(id);
          }}
        />
      ) : (
        <>
          {readOnly && (
            <div className="connection-banner">
              <LockKeyhole size={14} />
              <span>
                Reconnect to cloud sharing to edit this board. Your local draft
                is safe.
              </span>
              <button onClick={() => setModal("cloud")}>Open Settings</button>
            </div>
          )}
          <div className="workspace-body">
            <ComponentPalette controller={controller} />

            <DiagramCanvas controller={controller} />

            {showInspector && <PropertiesPanel controller={controller} />}
          </div>
        </>
      )}

      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          <span>{toast}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {workspace.localStatus === "error" && (
        <div className="storage-error" role="alert">
          Your browser could not save a recovery copy. Keep this board open and
          check that changes save online before closing it.
        </div>
      )}

      {modal === "templates" && (
        <Modal
          title="Your next big idea starts here."
          subtitle="Start with a proven pattern, then make it yours."
          onClose={() => setModal(null)}
          wide
        >
          <div className="template-modal-grid">
            <TemplateCards disabled={creating} onChoose={newBoard} />
          </div>
        </Modal>
      )}
      {(modal === "join" || modal === "share") && (
        <SharingDialog
          key={modal === "join" ? invitationInput : "share"}
          mode={modal}
          board={board}
          cloud={cloud}
          initialCode={invitationInput}
          onJoined={(code, rejoined) => rejoined ? showHome() : showEditor(code)}
          onSettings={() => setModal("cloud")}
          onClose={() => {
            if (modal === "join") showHome();
            else setModal(null);
          }}
        />
      )}
      {(modal === "help" || modal === "shortcuts") && (
        <Modal title="A space for your systems." onClose={() => setModal(null)}>
          <div className="help-content">
            <p>Create or join a shared board. Drag, connect and annotate; export PNGs from Settings.</p>
            <p>Changes autosave online with local recovery. Keep your invitation code to rejoin removed boards.</p>
          </div>
          <h3>Keyboard shortcuts</h3>
          <div className="shortcuts-list">
            {shortcutRows.map(([label, keys]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
        </Modal>
      )}
      {modal === "cloud" && (
        <BoardSettingsDialog
          auth={auth}
          board={board}
          cloud={cloud}
          onShare={() => setModal("share")}
          exportPng={home ? undefined : exportPng}
          isExporting={isExporting}
          onClose={() => setModal(null)}
        />
      )}
      <footer className="app-footer"><span className="app-version">blueprint · {APP_VERSION}</span></footer>
    </div>
  );
}

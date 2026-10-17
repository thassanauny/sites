import { CheckCheck, LockKeyhole, LoaderCircle, X } from "lucide-react";
import { BoardHome } from "../features/boards/BoardHome";
import { SharingDialog } from "../features/sharing/SharingDialog";
import { Modal } from "../ui/Modal";
import { BoardSettingsDialog } from "../features/sharing/BoardSettingsDialog";
import { useAuth } from "../infrastructure/auth/useAuth";
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
  ["Export board", "⌘ / Ctrl S"],
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
    inputRef,
    showEditor,
    exportJson,
    newBoard,
    importFile,
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
          notice={cloud.error || auth.authError || undefined}
          onSettings={() => setModal("cloud")}
          onOpen={(id) => {
            workspace.switchBoard(id);
            showEditor();
          }}
          onNew={() => setModal("templates")}
          onJoin={() => {
            setInvitationInput("");
            setModal("join");
          }}
          onImport={() => inputRef.current?.click()}
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

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Import board file"
        onChange={(event) => importFile(event.target.files?.[0])}
      />
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
          Your browser could not save this board. Export a JSON backup to keep
          your work.
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
            {<TemplateCards onChoose={newBoard} />}
          </div>
        </Modal>
      )}
      {modal === "shortcuts" && (
        <Modal
          title="Less clicking. More thinking."
          subtitle="A few shortcuts to keep your ideas flowing."
          onClose={() => setModal(null)}
        >
          <div className="shortcuts-list">
            {shortcutRows.map(([label, keys]) => (
              <div key={label}>
                <span>{label}</span>
                <kbd>{keys}</kbd>
              </div>
            ))}
          </div>
          <p className="modal-footnote">
            Select a component to edit its properties. Drag between connection
            handles to connect components.
          </p>
        </Modal>
      )}
      {(modal === "join" || modal === "share") && (
        <SharingDialog
          mode={modal}
          board={board}
          cloud={cloud}
          initialCode={invitationInput}
          onJoined={showEditor}
          onSettings={() => setModal("cloud")}
          onClose={() => {
            setModal(null);
            if (location.hash.startsWith("#/join/"))
              history.replaceState(
                null,
                "",
                location.pathname + location.search,
              );
          }}
        />
      )}
      {modal === "cloud" && (
        <BoardSettingsDialog
          auth={auth}
          board={board}
          cloud={cloud}
          onShare={() => setModal("share")}
          exportJson={exportJson}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

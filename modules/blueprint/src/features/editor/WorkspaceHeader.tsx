import type { WorkspaceController } from "../../application/useWorkspaceController";
import { Logo } from "../../ui/Logo";
import {
  ArrowDownToLine,
  ChevronDown,
  ChevronRight,
  Share2,
  Download,
  FileJson,
  Keyboard,
  LoaderCircle,
  Settings2,
  Upload,
} from "lucide-react";
export function WorkspaceHeader({
  controller,
}: {
  controller: Pick<
    WorkspaceController,
    | "auth"
    | "workspace"
    | "cloud"
    | "board"
    | "setModal"
    | "exportOpen"
    | "setExportOpen"
    | "home"
    | "isExporting"
    | "inputRef"
    | "showHome"
    | "exportJson"
    | "exportPng"
  >;
}) {
  const {
    auth,
    workspace,
    cloud,
    board,
    setModal,
    exportOpen,
    setExportOpen,
    home,
    isExporting,
    inputRef,
    showHome,
    exportJson,
    exportPng,
  } = controller;
  return (
    <header className="topbar">
      <button
        className="brand-button"
        aria-label="Open your boards"
        onClick={showHome}
      >
        <Logo />
      </button>
      <div className="header-divider" />
      {home ? (
        <span className="home-header-label">My workspace</span>
      ) : (
        <>
          <button className="workspace-link" onClick={showHome}>
            My workspace
            <ChevronRight size={14} />
          </button>
          <button className="board-title-button" onClick={showHome}>
            <span>{board.title}</span>
            <ChevronDown size={14} />
          </button>
          <button
            className={`save-status status-${workspace.localStatus} ${cloud.status === "error" || cloud.status === "conflict" ? "status-error" : ""}`}
            onClick={() => (auth.user ? setModal("cloud") : undefined)}
          >
            <span />
            {workspace.localStatus === "error"
              ? "Storage full"
              : auth.user
                ? cloud.status === "saved"
                  ? "Saved to cloud"
                  : cloud.status === "loading"
                    ? "Loading cloud…"
                    : cloud.status === "saving"
                      ? "Saving to cloud…"
                      : "Cloud needs attention"
                : workspace.localStatus === "saving"
                  ? "Saving…"
                  : "Saved locally"}
          </button>
        </>
      )}
      <div className="header-actions">
        {!home && (
          <>
            <button
              className="icon-button shortcuts-button"
              title="Keyboard shortcuts (?)"
              aria-label="Keyboard shortcuts"
              onClick={() => setModal("shortcuts")}
            >
              <Keyboard size={19} />
            </button>
            <div className="export-wrapper">
              <button
                className="button secondary export-button"
                aria-expanded={exportOpen}
                onClick={() => setExportOpen(!exportOpen)}
              >
                {isExporting ? (
                  <LoaderCircle className="spin" size={16} />
                ) : (
                  <ArrowDownToLine size={16} />
                )}
                <span>Export</span>
                <ChevronDown size={13} />
              </button>
              {exportOpen && (
                <>
                  <button
                    className="menu-scrim"
                    aria-label="Close export menu"
                    onClick={() => setExportOpen(false)}
                  />
                  <div className="dropdown-menu">
                    <button onClick={exportPng}>
                      <Download size={16} />
                      <span>
                        Export as PNG
                        <small>An image of your architecture</small>
                      </span>
                    </button>
                    <button onClick={exportJson}>
                      <FileJson size={16} />
                      <span>
                        Export board<small>Editable JSON backup</small>
                      </span>
                    </button>
                    <div className="menu-divider" />
                    <button
                      onClick={() => {
                        inputRef.current?.click();
                        setExportOpen(false);
                      }}
                    >
                      <Upload size={16} />
                      <span>Import board</span>
                    </button>
                  </div>
                </>
              )}
            </div>
            <button
              className="icon-button"
              aria-label="Board settings"
              title="Board settings"
              onClick={() => setModal("cloud")}
            >
              <Settings2 size={19} />
            </button>
            <button
              className="button primary cloud-button"
              aria-label="Share board"
              onClick={() => setModal("share")}
            >
              <Share2 size={16} />
              <span>Share</span>
            </button>
          </>
        )}
        <button className="avatar" title="Your workspace" onClick={showHome}>
          {auth.user?.email?.[0]?.toUpperCase() || "Y"}
        </button>
      </div>
    </header>
  );
}

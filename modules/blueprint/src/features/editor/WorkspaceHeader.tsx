import { useEffect, useState } from "react";
import type { WorkspaceController } from "../../application/useWorkspaceController";
import { Logo } from "../../ui/Logo";
import {
  CircleHelp,
  Link,
  Settings2,
} from "lucide-react";
export function WorkspaceHeader({
  controller,
}: {
  controller: Pick<
    WorkspaceController,
    | "auth"
    | "cloud"
    | "board"
    | "setModal"
    | "home"
    | "showHome"
  >;
}) {
  const {
    auth,
    cloud,
    board,
    setModal,
    home,
    showHome,
  } = controller;
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  const connection = !online ? "Offline" : !auth.configured ? "Setup required" : auth.authError || cloud.error ? "Needs attention" : !auth.user || !cloud.ready ? "Connecting" : cloud.status === "loading" || cloud.status === "saving" ? "Syncing" : "Connected";
  return (
    <header className="topbar">
      <button
        className="brand-button"
        aria-label="Open your boards"
        onClick={showHome}
      >
        <Logo />
      </button>
      {home ? (
        <>
          <div className="header-divider" />
          <span className="home-header-label">My workspace</span>
        </>
      ) : (
        <h1 className="header-board-title" title={board.title}>{board.title}</h1>
      )}
      <div className="header-actions workspace-actions">
        {!home && (
          <>
            <button
              className="button primary workspace-invite cloud-button"
              aria-label="Invite"
              onClick={() => setModal("share")}
            >
              <Link size={18} />
              <span>Invite</span>
            </button>
            <button
              className="button secondary workspace-settings board-settings-button"
              aria-label="Board settings"
              title="Board settings"
              onClick={() => setModal("cloud")}
            >
              <Settings2 size={16} />
              <span>Settings</span>
            </button>
          </>
        )}
        <span className={`connection ${!online || auth.authError || cloud.error ? "offline" : ""}`} aria-label={connection} title={connection}>
          <span className="connection-dot" aria-hidden="true" />
          <span className="connection-label">{connection}</span>
        </span>
        <button className="icon-button help-button" aria-label="Help" onClick={() => setModal("help")}>
          <CircleHelp size={21} />
        </button>
      </div>
    </header>
  );
}

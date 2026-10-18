import { useLayoutEffect, useRef } from 'react';
import { fitBrand } from '../../ui/fitBrand';
import { CircleHelp, Link, Settings2 } from 'lucide-react';

export function WorkspaceHeader({
  atHome,
  boardTitle,
  status,
  offline,
  onHome,
  onHelp,
  busy,
  onInvite,
  onSettings,
}: {
  atHome: boolean;
  busy: boolean;
  onInvite: () => void;
  onSettings: () => void;
  boardTitle?: string;
  status: string;
  offline: boolean;
  onHome: () => void;
  onHelp: () => void;
}) {
  const header = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => fitBrand(header.current!), []);
  return (
    <header className="site-header">
      <div className="header-inner" ref={header}>
        <button
          type="button"
          className="brand"
          aria-label="Open workspace"
          aria-current={atHome ? 'page' : undefined}
          onClick={onHome}
        >
          <span className="brand-mark">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} width="37" height="37" alt="" />
          </span>
          <span>
            pinboard<span className="brand-dot">.</span>
          </span>
        </button>
        {!atHome && boardTitle && (
          <h1 className="header-board-title" title={boardTitle}>
            {boardTitle}
          </h1>
        )}
        <div className="header-actions workspace-actions">
          {!atHome && boardTitle && (
            <>
              {' '}
              <button
                type="button"
                className="button primary workspace-invite"
                aria-label="Invite"
                title="Invite"
                onClick={onInvite}
              >
                <Link size={18} />
                <span>Invite</span>
              </button>
              <button
                type="button"
                className="button secondary workspace-settings"
                aria-label="Settings"
                title="Settings"
                onClick={onSettings}
                disabled={busy}
              >
                <Settings2 size={16} />
                <span>Settings</span>
              </button>{' '}
            </>
          )}
          <span className={`connection ${offline ? 'offline' : ''}`}>
            <span />
            <span className="connection-label">{status}</span>
          </span>
          <button
            type="button"
            className="icon-button help-button"
            aria-label="Help"
            onClick={onHelp}
          >
            <CircleHelp size={21} />
          </button>
        </div>
      </div>
    </header>
  );
}

import { CircleHelp, Columns3 } from 'lucide-react';

export function WorkspaceHeader({
  atHome,
  status,
  offline,
  onHome,
  onHelp,
}: {
  atHome: boolean;
  status: string;
  offline: boolean;
  onHome: () => void;
  onHelp: () => void;
}) {
  return (
    <header className="site-header">
      <div className="header-inner">
        <button
          type="button"
          className="brand"
          aria-label="Open workspace"
          aria-current={atHome ? 'page' : undefined}
          onClick={onHome}
        >
          <span className="brand-mark">
            <Columns3 size={23} strokeWidth={2.5} />
          </span>
          <span>
            pinboard<span className="brand-dot">.</span>
          </span>
        </button>
        <div className="header-actions">
          <span className={`connection ${offline ? 'offline' : ''}`}>
            <span />
            {status}
          </span>
          <button type="button" className="icon-button" aria-label="Help" onClick={onHelp}>
            <CircleHelp size={21} />
          </button>
        </div>
      </div>
    </header>
  );
}

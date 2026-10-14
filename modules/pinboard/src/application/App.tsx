import { Check, ChevronRight, CircleHelp, LoaderCircle, Settings2, WifiOff, X } from 'lucide-react';
import { BoardDialog } from '../features/boards/BoardDialog';
import { BoardView } from '../features/boards/BoardView';
import { HomeView } from '../features/boards/HomeView';
import { Sidebar } from '../features/boards/Sidebar';
import { cloudConfigured } from '../infrastructure/cloud/boards';
import { SESSION_CORRUPT_MESSAGE } from '../infrastructure/auth/migrateSession';
import { useWorkspace } from './useWorkspace';
import { version } from '../../package.json';
export default function App() {
  const {
    board,
    boardList,
    visibleCount,
    workspaceCardCount,
    selectedCode,
    loaded,
    removalsReady,
    refreshing,
    busy,
    offline,
    error,
    notice,
    lastSync,
    navigations,
    modal,
    modalBoard,
    modalRemoved,
    disabled,
    refreshDisabled,
    setModal,
    closeModal,
    navigate,
    retry,
    startSession,
    refreshNow,
    dismissError,
    setNotice,
    create,
    join,
    recoverDraft,
    removeDeviceBoard,
    openSettings,
    openInvite,
    openColumn,
    addColumn,
    openCard,
    addCard,
    moveCard,
    dropCard,
    save,
  } = useWorkspace();
  // Compared by value, so the board is rendered again at midnight to mark newly overdue cards.
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <div className="app-shell">
      <Sidebar
        boards={boardList}
        activeId={board?.id}
        atHome={!selectedCode}
        showEmptyHint={loaded && visibleCount === 0}
        disabled={disabled}
        status={
          !cloudConfigured
            ? 'Setup needed'
            : offline || error
              ? 'Sync paused'
              : lastSync
                ? `Synced ${lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                : 'Connecting…'
        }
        statusTitle={lastSync ? `Last synced ${lastSync.toLocaleString()}` : undefined}
        version={version}
        onHome={() => navigate()}
        onOpen={navigate}
        onCreate={() => setModal({ type: 'create' })}
        onJoin={() => setModal({ type: 'join' })}
      />
      <main className="main">
        <header className="topbar">
          <div className="breadcrumb">
            {board ? (
              <>
                <span>Workspace</span>
                <ChevronRight size={14} />
                <strong>{board.title}</strong>
              </>
            ) : (
              <strong>Workspace</strong>
            )}
          </div>
          <div className="topbar-actions">
            <span className={`connection ${offline || error ? 'offline' : ''}`}>
              <span />
              {offline
                ? 'Offline'
                : !cloudConfigured
                  ? 'Setup needed'
                  : busy
                    ? 'Saving…'
                    : refreshing
                      ? 'Syncing'
                      : error
                        ? 'Sync unavailable'
                        : lastSync
                          ? 'All changes saved'
                          : 'Connecting'}
            </span>
            <button
              type="button"
              className="icon-button"
              aria-label="Help"
              onClick={() => setModal({ type: 'help' })}
            >
              <CircleHelp size={19} />
            </button>
          </div>
        </header>
        {!cloudConfigured && (
          <div className="banner warning">
            <Settings2 size={18} />
            <span>
              Add the public Supabase settings to enable shared boards. See the app’s setup guide.
            </span>
          </div>
        )}
        {offline && (
          <div className="banner warning">
            <WifiOff size={18} />
            <span>You’re offline. Reconnect to save changes or open another board.</span>
          </div>
        )}
        {error && (
          <div className="banner error" role="alert">
            <span>{error}</span>
            {error === SESSION_CORRUPT_MESSAGE && (
              <button type="button" className="text-button" onClick={() => void startSession()}>
                Start a new session
              </button>
            )}
            <button type="button" className="text-button" onClick={retry}>
              Retry
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Dismiss error"
              onClick={dismissError}
            >
              <X size={17} />
            </button>
          </div>
        )}
        {board ? (
          <BoardView
            board={board}
            busy={busy}
            disabled={disabled}
            refreshDisabled={refreshDisabled}
            refreshing={refreshing}
            resetKey={navigations}
            today={today}
            onRefresh={refreshNow}
            onSettings={openSettings}
            onInvite={openInvite}
            onAddCard={addCard}
            onAddColumn={addColumn}
            onEditColumn={openColumn}
            onEditCard={openCard}
            onMoveCard={moveCard}
            onDropCard={dropCard}
          />
        ) : (
          <HomeView
            boards={boardList}
            loaded={loaded}
            disabled={disabled}
            cardCount={workspaceCardCount}
            showCardCount={Boolean(lastSync) && removalsReady}
            onCreate={() => setModal({ type: 'create' })}
            onJoin={() => setModal({ type: 'join' })}
            onOpen={navigate}
          />
        )}
      </main>
      {notice && (
        <div className="toast" role="status">
          <Check size={17} />
          {notice}
        </div>
      )}
      {busy && !modal && (
        <div className="saving-pill" role="status">
          <LoaderCircle size={16} className="spin" />
          Saving…
        </div>
      )}
      {modal && (
        <BoardDialog
          key={
            modal.type === 'join'
              ? `join:${modal.code ?? ''}`
              : modal.type === 'card'
                ? `card:${modal.card.id}`
                : modal.type === 'column'
                  ? `column:${modal.column.id}`
                  : 'board' in modal
                    ? `${modal.type}:${modal.board.id}`
                    : modal.type
          }
          modal={modal}
          busy={busy}
          offline={offline}
          removed={modalRemoved}
          serverError={error}
          currentBoard={modalBoard}
          onClose={() => closeModal(modal)}
          onSave={save}
          onCreate={create}
          onJoin={join}
          onRecover={recoverDraft}
          onRemove={removeDeviceBoard}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

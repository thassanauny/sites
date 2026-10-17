import { Check, LoaderCircle, Settings2, WifiOff, X } from 'lucide-react';
import { BoardDialog } from '../features/boards/BoardDialog';
import { BoardView } from '../features/boards/BoardView';
import { HomeView } from '../features/boards/HomeView';
import { WorkspaceHeader } from '../features/boards/WorkspaceHeader';
import { Sidebar } from '../features/boards/Sidebar';
import { cloudConfigured } from '../infrastructure/cloud/boards';
import { SESSION_CORRUPT_MESSAGE } from '../infrastructure/auth/migrateSession';
import { useWorkspace } from './useWorkspace';
import { useBoardFilters } from './useBoardFilters';
import { version } from '../../package.json';
export default function App() {
  const {
    board,
    boardList,
    visibleCount,
    selectedCode,
    routeInvalid,
    loaded,
    loadingBoard,
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
    openCard,
    addCard,
    moveCard,
    dropCard,
    reorderCard,
    save,
  } = useWorkspace();
  const { filters, setFilters, clearFilters, orderedCards, columnCards, filteredCount } =
    useBoardFilters(board, navigations);
  // Compared by value, so the board is rendered again at midnight to mark newly overdue cards.
  const today = new Date().toLocaleDateString('en-CA');
  return (
    <div className={`app-shell${board ? '' : ' at-home'}`}>
      <button
        type="button"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </button>
      <WorkspaceHeader
        atHome={!selectedCode}
        boardTitle={board?.title}
        busy={busy}
        onInvite={openInvite}
        onSettings={openSettings}
        offline={offline || !!error}
        status={
          offline
            ? 'Offline'
            : !cloudConfigured
              ? 'Setup required'
              : busy
                ? 'Saving…'
                : refreshing
                  ? 'Syncing'
                  : error
                    ? 'Sync unavailable'
                    : lastSync
                      ? 'Connected'
                      : 'Connecting'
        }
        onHome={() => navigate()}
        onHelp={() => setModal({ type: 'help' })}
      />
      {board && (
        <Sidebar
          boards={boardList}
          activeId={board?.id}
          currentBoard={board}
          visibleCardCount={filteredCount}
          showEmptyHint={loaded && visibleCount === 0}
          disabled={disabled || offline}
          onOpen={navigate}
          onCreate={() => setModal({ type: 'create' })}
        />
      )}
      <main id="main-content" tabIndex={-1} className="main">
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
            <span>
              You’re offline. Saved boards can be edited on this device and sync automatically when
              connected.
            </span>
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
        {routeInvalid ? (
          <section className="home" role="alert">
            <h1>Page not found</h1>
            <p>This link is not supported.</p>
            <button type="button" className="button secondary" onClick={() => navigate()}>
              Go home
            </button>
          </section>
        ) : board ? (
          <BoardView
            board={board}
            disabled={disabled}
            refreshDisabled={refreshDisabled}
            refreshing={refreshing}
            filters={filters}
            orderedCards={orderedCards}
            columnCards={columnCards}
            filteredCount={filteredCount}
            onFiltersChange={setFilters}
            onClearFilters={clearFilters}
            today={today}
            onRefresh={refreshNow}
            onAddCard={addCard}
            onEditColumn={openColumn}
            onEditCard={openCard}
            onMoveCard={moveCard}
            onDropCard={dropCard}
            onReorderCard={reorderCard}
          />
        ) : loadingBoard ? (
          <section className="loading" role="status">
            <LoaderCircle size={24} className="spin" />
            Opening your board…
          </section>
        ) : (
          <HomeView
            boards={boardList}
            loaded={loaded}
            disabled={disabled || offline}
            onCreate={() => setModal({ type: 'create' })}
            onJoin={() => setModal({ type: 'join' })}
            onOpen={navigate}
          />
        )}
      </main>
      <footer className="app-footer">
        <span className="footer-sync">
          {lastSync ? (
            <>
              Synced{' '}
              <time dateTime={lastSync.toISOString()}>
                {lastSync.toLocaleTimeString('en-US', {
                  hour: '2-digit',
                  minute: '2-digit',
                  hour12: true,
                })}
              </time>
            </>
          ) : (
            'Waiting for first sync.'
          )}
        </span>
        <span className="app-version">pinboard · {version}</span>
      </footer>
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
          offline={offline && (modal.type === 'create' || modal.type === 'join' || modalRemoved)}
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

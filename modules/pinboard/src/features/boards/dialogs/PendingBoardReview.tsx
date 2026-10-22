import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Board } from '../../../domain/boards/types';
import { compareBoards } from '../../../domain/boards/comparison';
import type { PendingBoardReview as BoardReview } from '../../../infrastructure/cloud/offlineBoards';
import { FormError } from './shared';

export function downloadBoardDraft(board: Board) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(board, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'pinboard-device-draft.json';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function PendingBoardReview({
  board,
  busy,
  serverError,
  onClose,
  onBack,
  onReview,
  onResolve,
  onForce,
}: {
  board: Board;
  busy: boolean;
  serverError: string;
  onClose: () => void;
  onBack: () => void;
  onReview: (id: string) => Promise<BoardReview>;
  onResolve: (review: BoardReview, action: 'retry' | 'discard') => Promise<boolean>;
  onForce: (review: BoardReview) => Promise<boolean>;
}) {
  const [review, setReview] = useState<BoardReview>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [confirmForce, setConfirmForce] = useState(false);
  const differences = useMemo(
    () => (review ? compareBoards(review.local, review.shared) : []),
    [review],
  );
  const refresh = useCallback(async () => {
    setLoading(true);
    setConfirmForce(false);
    setError('');
    try {
      setReview(await onReview(board.id));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not review these edits.');
    } finally {
      setLoading(false);
    }
  }, [board.id, onReview]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const resolve = async (action: 'retry' | 'discard') => {
    if (review && (await onResolve(review, action))) onClose();
  };
  return (
    <>
      <p className="dialog-intro">
        Only differences between this device and the shared board are shown. Recovery actions keep a
        backup on this device.
      </p>
      {loading ? (
        <p role="status">Loading the latest shared board…</p>
      ) : (
        review && (
          <>
            <p>
              {review.forcePending
                ? 'A confirmed force sync is waiting to finish.'
                : review.unappliedBackupId
                  ? 'A deleted-card draft could not be queued. Its device backup needs an explicit recovery choice.'
                  : review.pendingIds.length
                    ? `${review.pendingIds.length} edit${review.pendingIds.length === 1 ? '' : 's'} waiting to sync.`
                    : 'No edits are waiting to sync.'}
            </p>
            {differences.length ? (
              <section aria-label="Board changes">
                <ol className="board-differences">
                  {differences.map((change) => (
                    <li key={change.id}>
                      <h3>{change.label}</h3>
                      <div className="board-difference-values">
                        <div className="comparison-local">
                          <h4>On this device</h4>
                          <p>{change.local}</p>
                        </div>
                        <div className="comparison-shared">
                          <h4>{review.online ? 'Shared board' : 'Last downloaded board'}</h4>
                          <p>{change.shared}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ) : (
              <p className="soft-note">
                No differences. This device matches{' '}
                {review.online ? 'the shared board' : 'the last downloaded board'}.
              </p>
            )}
            {review.forcePending && (
              <p role="status">
                Your confirmed force sync is waiting for acknowledgement. It retries automatically.
              </p>
            )}
            {confirmForce ? (
              <section aria-label="Confirm force sync" className="force-sync-confirmation">
                <p>
                  Replace the entire shared board with the device version shown here? Changes from
                  other people may be overwritten. A local backup is kept.
                </p>
                <div className="dialog-actions">
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setConfirmForce(false)}
                  >
                    Cancel force sync
                  </button>
                  <button
                    type="button"
                    className="button primary"
                    disabled={busy || !navigator.onLine}
                    onClick={async () => {
                      if (await onForce(review)) onClose();
                      else await refresh();
                    }}
                  >
                    Replace shared board
                  </button>
                </div>
              </section>
            ) : (
              <button
                type="button"
                className="button secondary"
                disabled={
                  busy ||
                  loading ||
                  !review.online ||
                  !navigator.onLine ||
                  review.forcePending ||
                  !differences.length
                }
                onClick={() => setConfirmForce(true)}
              >
                Force sync my changes
              </button>
            )}
            {review.backups.length > 0 && (
              <section aria-label="Saved device backups">
                <h3>Saved device backups</h3>
                {review.backups.map((backup, index) => (
                  <p key={backup.id}>
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => downloadBoardDraft(backup.board)}
                    >
                      Download backup {index + 1}
                    </button>{' '}
                    · {new Date(backup.createdAt).toLocaleString()}
                  </p>
                ))}
              </section>
            )}
            {!review.online && (
              <p>Reconnect and refresh this review to retry or discard pending edits.</p>
            )}
            {review.retryError && <p>{review.retryError}</p>}
          </>
        )
      )}
      {(error || serverError) && <FormError>{error || serverError}</FormError>}
      <div className="dialog-actions">
        <button type="button" className="button quiet" disabled={busy} onClick={onBack}>
          Back to settings
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          Refresh review
        </button>
        {!!review &&
          (review.pendingIds.length > 0 || !!review.unappliedBackupId || review.forcePending) && (
            <>
              <button
                type="button"
                className="button secondary"
                disabled={loading || busy || !review.online}
                onClick={() => void resolve('discard')}
              >
                Use shared board
              </button>
              {!review.retryError && !review.forcePending && (
                <button
                  type="button"
                  className="button primary"
                  disabled={loading || busy || !review.online}
                  onClick={() => void resolve('retry')}
                >
                  Retry reviewed edits
                </button>
              )}
            </>
          )}
      </div>
    </>
  );
}

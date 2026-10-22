import { useCallback, useEffect, useState } from 'react';
import type { Board } from '../../../domain/boards/types';
import type { PendingBoardReview } from '../../../infrastructure/cloud/offlineBoards';
import { Dialog } from '../../../ui/Dialog';
import { FormError } from './shared';

function describe(board: Board): string {
  return [
    board.title,
    board.description,
    ...board.columns.flatMap((column) => [
      `\n${column.title}`,
      ...board.cards
        .filter((card) => card.columnId === column.id)
        .map((card) =>
          [
            `${card.archived ? '(Archived) ' : ''}${card.title}`,
            card.description,
            `Priority: ${card.priority}${card.assignee ? ` · Assigned to: ${card.assignee}` : ''}${card.dueDate ? ` · Due: ${card.dueDate}` : ''}`,
            card.labels.join(', '),
            ...Object.entries(card.customFields ?? {}).map(
              ([id, value]) =>
                `${board.card_fields?.custom.find((field) => field.id === id)?.title ?? 'Custom field'}: ${value}`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        ),
    ]),
  ]
    .filter(Boolean)
    .join('\n');
}
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

export function PendingBoardDialog({
  board,
  busy,
  serverError,
  onClose,
  onReview,
  onResolve,
}: {
  board: Board;
  busy: boolean;
  serverError: string;
  onClose: () => void;
  onReview: (id: string) => Promise<PendingBoardReview>;
  onResolve: (review: PendingBoardReview, action: 'retry' | 'discard') => Promise<boolean>;
}) {
  const [review, setReview] = useState<PendingBoardReview>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
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
    <Dialog title="Review device edits" busy={busy} onClose={onClose} wide>
      <p className="dialog-intro">
        Compare this device's saved work with the shared board. Either choice keeps a downloadable
        copy of your local draft on this device.
      </p>
      {loading ? (
        <p role="status">Loading the latest shared board…</p>
      ) : (
        review && (
          <>
            <p>
              {review.unappliedBackupId
                ? 'A deleted-card draft could not be queued. It is backed up on this device and will not upload.'
                : review.pendingIds.length
                  ? `${review.pendingIds.length} edit${review.pendingIds.length === 1 ? '' : 's'} waiting to sync.`
                  : 'No edits are waiting to sync.'}
            </p>
            <label className="field">
              Saved on this device
              <textarea
                aria-label="Saved on this device"
                readOnly
                rows={7}
                value={describe(review.local)}
              />
            </label>
            <label className="field">
              {review.online ? 'Latest shared board' : 'Last downloaded shared board'}
              <textarea
                aria-label={review.online ? 'Latest shared board' : 'Last downloaded shared board'}
                readOnly
                rows={7}
                value={describe(review.shared)}
              />
            </label>
            <button
              type="button"
              className="button secondary"
              onClick={() => downloadBoardDraft(review.local)}
            >
              Download local draft
            </button>
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
        <button
          type="button"
          className="button secondary"
          disabled={loading || busy}
          onClick={() => void refresh()}
        >
          Refresh review
        </button>
        {!!review && (review.pendingIds.length > 0 || !!review.unappliedBackupId) && (
          <>
            <button
              type="button"
              className="button secondary"
              disabled={loading || busy || !review.online}
              onClick={() => void resolve('discard')}
            >
              Use shared board
            </button>
            {!review.retryError && (
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
    </Dialog>
  );
}

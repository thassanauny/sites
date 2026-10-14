import { useState, type FormEvent } from 'react';
import type { Board, Card, Operation } from '../../../domain/boards/types';
import { LIMITS, cardPatch, nextPosition } from '../../../domain/boards/board';
import { Dialog } from '../../../ui/Dialog';
import { message } from '../../../ui/message';
import {
  DescriptionField,
  DiscardDraft,
  DraftRecovery,
  EditorForm,
  TitleField,
  useDialogMessages,
  useDraftClose,
} from './shared';

export function CardDialog({
  board,
  initial,
  isNew,
  currentBoard,
  busy,
  offline,
  removed,
  serverError,
  onClose: closeModal,
  onSave,
  onRecover,
  onNotice,
}: {
  board: Board;
  initial: Card;
  isNew: boolean;
  currentBoard?: Board;
  busy: boolean;
  offline: boolean;
  removed: boolean;
  serverError: string;
  onClose: () => void;
  onSave: (boardId: string, operation: Operation) => Promise<boolean>;
  onRecover: (code: string) => Promise<boolean>;
  onNotice: (text: string) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const [card, setCard] = useState<Card>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { localError, setLocalError, copy } = useDialogMessages(onNotice);
  const edited = {
    ...card,
    title: title.trim(),
    description: description.trim(),
    assignee: card.assignee.trim(),
    labels: [...new Set(card.labels.map((label) => label.trim()).filter(Boolean))],
  };
  const patch = cardPatch(initial, edited);
  const discard = useDraftClose(removed || Object.keys(patch).length > 0, closeModal);
  const locked = busy || offline || removed;
  const liveBoard = currentBoard ?? board;
  const currentColumns = liveBoard.columns;
  const draftText = [
    title,
    description,
    `Column: ${currentColumns.find((column) => column.id === card.columnId)?.title ?? card.columnId}`,
    `Priority: ${card.priority}`,
    `Assignee: ${card.assignee}`,
    `Due date: ${card.dueDate}`,
    `Labels: ${card.labels.join(', ')}`,
  ].join('\n');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (locked) return;
    try {
      const saved = isNew
        ? await onSave(board.id, { type: 'create_card', card: edited })
        : Object.keys(patch).length === 0 ||
          (await onSave(board.id, {
            type: 'update_card',
            id: card.id,
            patch,
          }));
      if (saved) closeModal();
    } catch (error) {
      setLocalError(message(error));
    }
  }
  async function remove() {
    if (locked) return;
    if (await onSave(board.id, { type: 'delete_card', id: initial.id })) closeModal();
  }
  return (
    <Dialog
      title={
        discard.confirming ? 'Discard this draft?' : isNew ? 'A new thing to do.' : 'Card details'
      }
      busy={busy}
      onClose={discard.confirming ? discard.keepEditing : discard.close}
      wide={!discard.confirming}
    >
      {discard.confirming ? (
        <DiscardDraft
          busy={busy}
          removed={removed}
          onKeep={discard.keepEditing}
          onDiscard={closeModal}
        />
      ) : (
        <EditorForm
          recovery={
            removed && (
              <DraftRecovery
                busy={busy}
                offline={offline}
                draftText={draftText}
                onJoin={() => {
                  setLocalError('');
                  void onRecover(board.invite_code).catch((failure) =>
                    setLocalError(message(failure)),
                  );
                }}
                onCopy={() => void copy(draftText, 'Draft')}
                onDiscard={discard.askToDiscard}
              />
            )
          }
          localError={localError}
          serverError={serverError}
          offline={offline}
          busy={busy}
          locked={locked}
          onCancel={discard.close}
          submitLabel="Save"
          deleteLabel={isNew ? undefined : 'Delete'}
          onDelete={isNew ? undefined : () => setConfirmDelete(true)}
          onSubmit={(event) => void submit(event)}
        >
          <TitleField
            label="Card title"
            value={title}
            placeholder="What needs doing?"
            onChange={setTitle}
          />
          <DescriptionField rows={4} value={description} onChange={setDescription} />
          <div className="form-grid">
            <label className="field">
              Column
              <select
                value={card.columnId}
                onChange={(event) =>
                  setCard({
                    ...card,
                    columnId: event.target.value,
                    position: nextPosition(liveBoard, event.target.value),
                  })
                }
              >
                {!currentColumns.some((column) => column.id === card.columnId) && (
                  <option value={card.columnId} disabled>
                    Column removed — choose another
                  </option>
                )}
                {currentColumns.map((column) => (
                  <option value={column.id} key={column.id}>
                    {column.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Priority
              <select
                value={card.priority}
                onChange={(event) =>
                  setCard({
                    ...card,
                    priority: event.target.value as Card['priority'],
                  })
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            <label className="field">
              Assignee <span className="optional">optional</span>
              <input
                value={card.assignee}
                maxLength={LIMITS.assignee}
                placeholder="A name"
                onChange={(event) => setCard({ ...card, assignee: event.target.value })}
              />
            </label>
            <label className="field">
              Due date <span className="optional">optional</span>
              <input
                type="date"
                min="0001-01-01"
                max="9999-12-31"
                value={card.dueDate}
                onChange={(event) => setCard({ ...card, dueDate: event.target.value })}
              />
            </label>
          </div>
          <label className="field">
            Labels <span className="optional">optional · separated by commas</span>
            <input
              value={card.labels.join(',')}
              onChange={(event) => setCard({ ...card, labels: event.target.value.split(',') })}
              placeholder="Design, personal, this week"
            />
          </label>
          {confirmDelete && (
            <div className="delete-confirm">
              <p>Delete this card? This cannot be undone.</p>
              <button
                className="button danger"
                type="button"
                disabled={locked}
                onClick={() => void remove()}
              >
                Confirm delete
              </button>
              <button
                className="button quiet"
                type="button"
                onClick={() => setConfirmDelete(false)}
              >
                Keep it
              </button>
            </div>
          )}
        </EditorForm>
      )}
    </Dialog>
  );
}

import { sameShape, useRecoveryDraft } from '../../../application/useRecoveryDraft';
import { useState, type FormEvent } from 'react';
import type { Board, Card, Operation } from '../../../domain/boards/types';
import { cardPatch, nextPosition } from '../../../domain/boards/board';
import {
  boardAssignees,
  cardFields,
  FIELD_LIMITS,
  fieldVisible,
} from '../../../domain/boards/fields';
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
  const sample = {
    baseline: initial,
    title: initial.title,
    description: initial.description,
    card: initial,
  };
  const recovery = useRecoveryDraft(
    `${board.invite_code}:card:${isNew ? `new-${initial.columnId}` : initial.id}`,
    sample,
    (value): value is typeof sample => sameShape(sample, value),
  );
  const { title, description, card, baseline } = recovery.value;
  const setTitle = (title: string) => recovery.setValue((current) => ({ ...current, title }));
  const setDescription = (description: string) =>
    recovery.setValue((current) => ({ ...current, description }));
  const setCard = (card: Card) => recovery.setValue((current) => ({ ...current, card }));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { localError, setLocalError, copy } = useDialogMessages(onNotice);
  const liveBoard = currentBoard ?? board;
  const fields = cardFields(liveBoard);
  const edited = {
    ...card,
    title: title.trim(),
    description: fieldVisible(fields, 'description') ? description.trim() : description,
    assignee: fieldVisible(fields, 'assignee') ? card.assignee.trim() : card.assignee,
    labels: fieldVisible(fields, 'labels')
      ? [...new Set(card.labels.map((label) => label.trim()).filter(Boolean))]
      : card.labels,
  };
  const patch = cardPatch(baseline, edited);
  const discard = useDraftClose(removed || Object.keys(patch).length > 0, closeModal);
  const locked = busy || offline || removed;
  const currentColumns = liveBoard.columns;
  const assignees = boardAssignees(liveBoard);
  const draftText = [
    title,
    description,
    `Column: ${currentColumns.find((column) => column.id === card.columnId)?.title ?? card.columnId}`,
    `Priority: ${card.priority}`,
    `Assignee: ${card.assignee}`,
    `Due date: ${card.dueDate}`,
    `Labels: ${card.labels.join(', ')}`,
    ...fields.custom.map((field) => `${field.title}: ${card.customFields?.[field.id] ?? ''}`),
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
      if (saved) {
        recovery.clear();
        closeModal();
      }
    } catch (error) {
      setLocalError(message(error));
    }
  }
  async function remove() {
    if (locked) return;
    if (await onSave(board.id, { type: 'delete_card', id: initial.id })) {
      recovery.clear();
      closeModal();
    }
  }
  async function archive() {
    if (locked || isNew) return;
    setLocalError('');
    try {
      if (
        await onSave(board.id, {
          type: 'update_card',
          id: initial.id,
          patch: { ...patch, archived: true },
        })
      ) {
        recovery.clear();
        closeModal();
      }
    } catch (failure) {
      setLocalError(message(failure));
    }
  }
  return (
    <Dialog
      title={
        discard.confirming ? 'Discard this draft?' : isNew ? 'A new thing to do.' : 'Card details'
      }
      busy={busy}
      onClose={discard.confirming ? discard.keepEditing : discard.close}
      wide={!discard.confirming}
      className={discard.confirming ? '' : 'card-dialog'}
    >
      {discard.confirming ? (
        <DiscardDraft
          busy={busy}
          removed={removed}
          onKeep={discard.keepEditing}
          onDiscard={() => {
            if (recovery.clear()) closeModal();
          }}
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
          localError={localError || recovery.error}
          serverError={serverError}
          offline={offline}
          busy={busy}
          locked={locked}
          onCancel={discard.close}
          submitLabel="Save"
          deleteLabel={isNew ? undefined : 'Delete'}
          onDelete={isNew ? undefined : () => setConfirmDelete(true)}
          onArchive={isNew ? undefined : () => void archive()}
          onSubmit={(event) => void submit(event)}
        >
          {recovery.recovered && (
            <p className="soft-note">
              Recovered unsaved draft from this device. Review it before saving.
            </p>
          )}
          <TitleField
            label="Card title"
            value={title}
            placeholder="What needs doing?"
            onChange={setTitle}
          />
          {fieldVisible(fields, 'description') && (
            <DescriptionField rows={3} value={description} onChange={setDescription} />
          )}
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
            {fieldVisible(fields, 'priority') && (
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
            )}
            {fieldVisible(fields, 'assignee') && (
              <label className="field">
                Assignee <span className="optional">optional</span>
                <select
                  value={card.assignee ? `name:${card.assignee}` : ''}
                  onChange={(event) => {
                    const value = event.target.value;
                    setCard({
                      ...card,
                      assignee: value.slice('name:'.length),
                    });
                  }}
                >
                  <option value="">Unassigned</option>
                  {card.assignee && !assignees.includes(card.assignee) && (
                    <option value={`name:${card.assignee}`} disabled>
                      {card.assignee} — removed
                    </option>
                  )}
                  {assignees.map((name) => (
                    <option key={name} value={`name:${name}`}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {fieldVisible(fields, 'dueDate') && (
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
            )}
          </div>
          {fieldVisible(fields, 'labels') && (
            <label className="field">
              Labels <span className="optional">optional · separated by commas</span>
              <input
                value={card.labels.join(',')}
                onChange={(event) => setCard({ ...card, labels: event.target.value.split(',') })}
                placeholder="Design, personal, this week"
              />
            </label>
          )}
          {fields.custom
            .filter((field) => !field.hidden)
            .map((field) => (
              <label className="field" key={field.id}>
                {field.title} <span className="optional">optional</span>
                <input
                  value={card.customFields?.[field.id] ?? ''}
                  maxLength={FIELD_LIMITS.value}
                  onChange={(event) =>
                    setCard({
                      ...card,
                      customFields: { ...card.customFields, [field.id]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
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

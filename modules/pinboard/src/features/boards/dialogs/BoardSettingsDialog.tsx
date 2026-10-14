import { useId, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp, LogOut } from 'lucide-react';
import type { Board, Operation } from '../../../domain/boards/types';
import { Dialog } from '../../../ui/Dialog';
import { message } from '../../../ui/message';
import {
  CopyField,
  DescriptionField,
  DiscardDraft,
  DraftRecovery,
  EditorForm,
  FormError,
  TitleField,
  useDialogMessages,
  useDraftClose,
} from './shared';

export function BoardSettingsDialog({
  board,
  currentBoard,
  busy,
  offline,
  removed,
  serverError,
  onClose: closeModal,
  onSave,
  onRecover,
  onRemove,
  onNotice,
}: {
  board: Board;
  currentBoard?: Board;
  busy: boolean;
  offline: boolean;
  removed: boolean;
  serverError: string;
  onClose: () => void;
  onSave: (boardId: string, operation: Operation) => Promise<boolean>;
  onRecover: (code: string) => Promise<boolean>;
  onRemove: (board: Board) => void;
  onNotice: (text: string) => void;
}) {
  const [title, setTitle] = useState(board.title);
  const [description, setDescription] = useState(board.description);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const { localError, setLocalError, copied, copy } = useDialogMessages(onNotice);
  const unsaved = title.trim() !== board.title || description.trim() !== board.description;
  const discard = useDraftClose(removed || unsaved, closeModal);
  const columnOrderTitleId = useId();
  const locked = busy || offline || removed;
  const currentColumns = (currentBoard ?? board).columns;
  const draftText = [title, description].join('\n');
  async function reorderColumn(id: string, direction: -1 | 1) {
    if (locked) return;
    const index = currentColumns.findIndex((column) => column.id === id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= currentColumns.length) return;
    const columnIds = currentColumns.map((column) => column.id);
    [columnIds[index], columnIds[destination]] = [columnIds[destination]!, columnIds[index]!];
    setLocalError('');
    try {
      await onSave((currentBoard ?? board).id, {
        type: 'reorder_columns',
        columnIds,
      });
    } catch (error) {
      setLocalError(message(error));
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (locked) return;
    try {
      const patch: { title?: string; description?: string } = {};
      if (title.trim() !== board.title) patch.title = title.trim();
      if (description.trim() !== board.description) patch.description = description.trim();
      const saved =
        Object.keys(patch).length === 0 ||
        (await onSave(board.id, { type: 'update_board', patch }));
      if (saved) closeModal();
    } catch (error) {
      setLocalError(message(error));
    }
  }
  const view = discard.confirming ? 'discard' : confirmRemove ? 'remove' : 'form';
  return (
    <Dialog
      title={
        view === 'discard'
          ? 'Discard this draft?'
          : view === 'remove'
            ? 'Remove from this device?'
            : 'Board settings'
      }
      busy={busy}
      onClose={view === 'discard' ? discard.keepEditing : discard.close}
    >
      {view === 'discard' ? (
        <DiscardDraft
          busy={busy}
          removed={removed}
          onKeep={discard.keepEditing}
          onDiscard={closeModal}
        />
      ) : view === 'remove' ? (
        <>
          <p className="dialog-intro">
            Remove <strong>{board.title}</strong> from your lists on this device. Everyone else
            keeps access, and the shared board stays intact.
          </p>
          <p className="dialog-intro">
            Keep the invitation code to join again. Unsaved details in this dialog will be
            discarded.
          </p>
          <CopyField
            code={board.invite_code}
            copied={copied}
            onCopy={() => void copy(board.invite_code, 'Code')}
          />
          {localError && <FormError>{localError}</FormError>}
          <div className="dialog-actions">
            <button
              type="button"
              // biome-ignore lint/a11y/noAutofocus: the safe action takes focus when the dialog opens.
              autoFocus
              className="button quiet"
              disabled={busy}
              onClick={() => {
                setConfirmRemove(false);
                setLocalError('');
              }}
            >
              Keep on this device
            </button>
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => {
                try {
                  onRemove(board);
                } catch (failure) {
                  setLocalError(message(failure));
                }
              }}
            >
              <LogOut size={16} />
              Remove from this device
            </button>
          </div>
        </>
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
          cancelLabel="Close"
          onCancel={discard.close}
          submitLabel="Save details"
          onSubmit={(event) => void submit(event)}
        >
          <TitleField
            label="Board name"
            value={title}
            placeholder="Give it a name"
            onChange={setTitle}
          />
          <DescriptionField rows={3} value={description} onChange={setDescription} />
          <section className="column-order-settings" aria-labelledby={columnOrderTitleId}>
            <h3 id={columnOrderTitleId}>Column order</h3>
            <p>Left to right on your board. Changes save immediately.</p>
            <ol className="column-order-list">
              {currentColumns.map((column, index) => (
                <li key={column.id} className={`color-${column.color}`}>
                  <span className="column-order-number">{index + 1}</span>
                  <span className="column-dot" />
                  <span className="column-order-name">{column.title}</span>
                  <div className="column-order-actions">
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Move ${column.title} earlier`}
                      title="Move earlier"
                      disabled={locked || index === 0}
                      onClick={() => void reorderColumn(column.id, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      aria-label={`Move ${column.title} later`}
                      title="Move later"
                      disabled={locked || index === currentColumns.length - 1}
                      onClick={() => void reorderColumn(column.id, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </section>
          <section className="device-board-actions">
            <h3>On this device</h3>
            <p>Remove this board from your lists on this device. Everyone else keeps access.</p>
            <button
              className="button secondary"
              type="button"
              disabled={busy || removed}
              onClick={() => {
                setLocalError('');
                setConfirmRemove(true);
              }}
            >
              <LogOut size={16} />
              Remove from this device
            </button>
          </section>
        </EditorForm>
      )}
    </Dialog>
  );
}

import { sameShape, useRecoveryDraft } from '../../../application/useRecoveryDraft';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import type { Board, Column, ColumnColor, Operation } from '../../../domain/boards/types';
import { COLUMN_COLORS } from '../../../domain/boards/board';
import { Dialog } from '../../../ui/Dialog';
import { message } from '../../../ui/message';
import {
  DiscardDraft,
  DraftRecovery,
  EditorForm,
  TitleField,
  useDialogMessages,
  useDraftClose,
} from './shared';

export function ColumnDialog({
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
  initial: Column;
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
  const sample = { baseline: initial, title: initial.title, color: initial.color };
  const recovery = useRecoveryDraft(
    `${board.invite_code}:column:${isNew ? 'new' : initial.id}`,
    sample,
    (value): value is typeof sample => sameShape(sample, value),
  );
  const { title, color, baseline } = recovery.value;
  const setTitle = (title: string) => recovery.setValue((current) => ({ ...current, title }));
  const setColor = (color: ColumnColor) => recovery.setValue((current) => ({ ...current, color }));
  const [target, setTarget] = useState(
    board.columns.find((column) => column.id !== initial.id)?.id ?? '',
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const colorLabelId = useId();
  const { localError, setLocalError, copy } = useDialogMessages(onNotice);
  const unsaved = title.trim() !== baseline.title || color !== baseline.color;
  const discard = useDraftClose(removed || unsaved, closeModal);
  const locked = busy || offline || removed;
  const currentColumns = (currentBoard ?? board).columns;
  const draftText = [title, `Color: ${color}`].join('\n');
  useEffect(() => {
    if (!currentColumns.some((column) => column.id === target && column.id !== initial.id)) {
      setTarget(currentColumns.find((column) => column.id !== initial.id)?.id ?? '');
    }
  }, [initial, currentColumns, target]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (locked) return;
    try {
      const column = { ...baseline, title: title.trim(), color };
      const patch: { title?: string; color?: ColumnColor } = {};
      if (column.title !== baseline.title) patch.title = column.title;
      if (column.color !== baseline.color) patch.color = column.color;
      const saved = isNew
        ? await onSave(board.id, { type: 'add_column', column })
        : Object.keys(patch).length === 0 ||
          (await onSave(board.id, {
            type: 'update_column',
            id: column.id,
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
    if (
      await onSave(board.id, {
        type: 'delete_column',
        id: initial.id,
        targetColumnId: target,
      })
    ) {
      recovery.clear();
      closeModal();
    }
  }
  return (
    <Dialog
      title={
        discard.confirming
          ? 'Discard this draft?'
          : isNew
            ? 'Make a little more room.'
            : 'Column settings'
      }
      busy={busy}
      onClose={discard.confirming ? discard.keepEditing : discard.close}
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
          deleteLabel={!isNew && currentColumns.length > 1 ? 'Remove' : undefined}
          onDelete={!isNew && currentColumns.length > 1 ? () => setConfirmDelete(true) : undefined}
          onSubmit={(event) => void submit(event)}
        >
          {recovery.recovered && (
            <p className="soft-note">
              Recovered unsaved draft from this device. Review it before saving.
            </p>
          )}
          <TitleField
            label="Column name"
            value={title}
            placeholder="Give it a name"
            onChange={setTitle}
          />
          {/* biome-ignore lint/a11y/useSemanticElements: a div keeps the existing swatch layout. */}
          <div role="group" aria-labelledby={colorLabelId}>
            <span className="field" id={colorLabelId}>
              Column color
            </span>
            <div className="color-picker">
              {COLUMN_COLORS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`color-choice color-${value} ${color === value ? 'selected' : ''}`}
                  aria-label={value}
                  aria-pressed={color === value}
                  onClick={() => setColor(value)}
                >
                  {color === value && <Check size={17} />}
                </button>
              ))}
            </div>
          </div>
          {confirmDelete && (
            <div className="delete-confirm">
              <p>Remove this column? Its cards move to the column you choose.</p>
              <label className="field">
                Move cards to
                <select value={target} onChange={(event) => setTarget(event.target.value)}>
                  {currentColumns
                    .filter((column) => column.id !== initial.id)
                    .map((column) => (
                      <option key={column.id} value={column.id}>
                        {column.title}
                      </option>
                    ))}
                </select>
              </label>
              <button
                className="button danger"
                type="button"
                disabled={locked || !target}
                onClick={() => void remove()}
              >
                Confirm removal
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

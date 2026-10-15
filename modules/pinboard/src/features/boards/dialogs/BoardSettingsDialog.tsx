import { useId, useState, type FormEvent } from 'react';
import { Archive, ArrowDown, ArrowUp, LogOut, Plus, Trash2 } from 'lucide-react';
import type { Board, Column, Operation } from '../../../domain/boards/types';
import {
  boardAssignees,
  cardFields,
  FIELD_LIMITS,
  sameFieldSettings,
} from '../../../domain/boards/fields';
import { COLUMN_COLORS, LIMITS, readCardFieldSettings } from '../../../domain/boards/board';
import { CardFieldsSettings } from './CardFieldsSettings';
import { ArchivedCardsView } from './ArchivedCardsView';
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
  const [fields, setFields] = useState(() => cardFields(board));
  const [newAssignee, setNewAssignee] = useState('');
  const [deleteAssignee, setDeleteAssignee] = useState('');
  const [newColumn, setNewColumn] = useState<Column>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const { localError, setLocalError, copied, copy } = useDialogMessages(onNotice);
  const fieldsChanged = !sameFieldSettings(fields, board.card_fields);
  const unsaved =
    title.trim() !== board.title ||
    description.trim() !== board.description ||
    fieldsChanged ||
    Boolean(newAssignee.trim()) ||
    Boolean(newColumn?.title || (newColumn && newColumn.color !== 'blue'));
  const discard = useDraftClose(removed || unsaved, closeModal);
  const columnOrderTitleId = useId();
  const assigneesTitleId = useId();
  const archiveTitleId = useId();
  const locked = busy || offline || removed;
  const currentColumns = (currentBoard ?? board).columns;
  const archivedCards = (currentBoard ?? board).cards.filter((card) => card.archived);
  const assignees = boardAssignees(currentBoard ?? board);
  const draftText = [
    title,
    description,
    ...(newAssignee ? [`New assignee: ${newAssignee}`] : []),
    ...(newColumn ? [`New column: ${newColumn.title} (${newColumn.color})`] : []),
    ...(fieldsChanged
      ? [
          `Hidden card fields: ${fields.hidden.join(', ')}`,
          ...fields.custom.map(
            (field) => `Custom field: ${field.title}${field.hidden ? ' (hidden)' : ''}`,
          ),
        ]
      : []),
  ].join('\n');
  async function addAssignee() {
    if (locked) return;
    setLocalError('');
    try {
      const name = newAssignee.trim();
      if (!name) throw new Error('Enter a name for the new assignee.');
      if (await onSave(board.id, { type: 'add_assignee', name })) setNewAssignee('');
    } catch (failure) {
      setLocalError(message(failure));
    }
  }
  async function removeAssignee() {
    if (locked || !deleteAssignee) return;
    setLocalError('');
    try {
      if (await onSave(board.id, { type: 'delete_assignee', name: deleteAssignee }))
        setDeleteAssignee('');
    } catch (failure) {
      setLocalError(message(failure));
    }
  }
  async function createColumn() {
    if (locked || !newColumn || currentColumns.length >= LIMITS.columns) return;
    setLocalError('');
    if (!newColumn.title.trim()) {
      setLocalError('Enter a name for the new column.');
      return;
    }
    try {
      if (
        await onSave(board.id, {
          type: 'add_column',
          column: { ...newColumn, title: newColumn.title.trim() },
        })
      )
        setNewColumn(undefined);
    } catch (failure) {
      setLocalError(message(failure));
    }
  }
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
      if (newColumn?.title.trim())
        throw new Error('Add the new column or cancel it before saving board details.');
      if (newAssignee.trim())
        throw new Error('Add the new assignee or clear its name before saving board details.');
      const patch: Extract<Operation, { type: 'update_board' }>['patch'] = {};
      if (title.trim() !== board.title) patch.title = title.trim();
      if (description.trim() !== board.description) patch.description = description.trim();
      if (fieldsChanged)
        patch.card_fields = readCardFieldSettings({
          ...fields,
          custom: fields.custom.map((field) => ({ ...field, title: field.title.trim() })),
        });
      const saved =
        Object.keys(patch).length === 0 ||
        (await onSave(board.id, { type: 'update_board', patch }));
      if (saved) closeModal();
    } catch (error) {
      setLocalError(message(error));
    }
  }
  const view = discard.confirming
    ? 'discard'
    : confirmRemove
      ? 'remove'
      : showArchive
        ? 'archive'
        : 'form';
  return (
    <Dialog
      className={
        view === 'form'
          ? 'board-settings-dialog'
          : view === 'archive'
            ? 'archive-dialog'
            : undefined
      }
      title={
        view === 'discard'
          ? 'Discard this draft?'
          : view === 'remove'
            ? 'Remove from this device?'
            : view === 'archive'
              ? 'Archived cards'
              : 'Board settings'
      }
      busy={busy}
      onClose={
        view === 'discard'
          ? discard.keepEditing
          : view === 'archive'
            ? () => setShowArchive(false)
            : discard.close
      }
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
      ) : view === 'archive' ? (
        <ArchivedCardsView
          board={currentBoard ?? board}
          busy={busy}
          locked={locked}
          offline={offline}
          removed={removed}
          serverError={serverError}
          onSave={onSave}
          onBack={() => setShowArchive(false)}
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
          cancelLabel="Close"
          onCancel={discard.close}
          submitLabel="Save details"
          onSubmit={(event) => void submit(event)}
        >
          <div className="board-settings-grid">
            <div className="settings-column">
              <TitleField
                label="Board name"
                value={title}
                placeholder="Give it a name"
                onChange={setTitle}
              />
              <DescriptionField rows={2} value={description} onChange={setDescription} />
              <section className="assignee-settings" aria-labelledby={assigneesTitleId}>
                <h3 id={assigneesTitleId}>Assignees</h3>
                <p>Manage the card dropdown. Changes save immediately.</p>
                <ul className="assignee-list">
                  {assignees.map((name) => (
                    <li key={name}>
                      <span>{name}</span>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={`Delete assignee ${name}`}
                        disabled={locked}
                        onClick={() => setDeleteAssignee(name)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </li>
                  ))}
                </ul>
                {deleteAssignee && (
                  <div className="delete-confirm">
                    <p>
                      Delete {deleteAssignee} from assignees? Their cards, including archived cards,
                      will become Unassigned.
                    </p>
                    <div className="inline-column-actions">
                      <button
                        type="button"
                        className="button danger"
                        disabled={locked}
                        onClick={() => void removeAssignee()}
                      >
                        Delete assignee
                      </button>
                      <button
                        type="button"
                        className="button quiet"
                        disabled={busy}
                        onClick={() => setDeleteAssignee('')}
                      >
                        Keep assignee
                      </button>
                    </div>
                  </div>
                )}
                <div className="assignee-add-row">
                  <label className="field">
                    New assignee
                    <input
                      value={newAssignee}
                      maxLength={LIMITS.assignee}
                      onChange={(event) => setNewAssignee(event.target.value)}
                      placeholder="A name"
                    />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => void addAssignee()}
                    disabled={locked || assignees.length >= FIELD_LIMITS.assignees}
                  >
                    <Plus size={16} /> Add assignee
                  </button>
                </div>
              </section>
              <section className="column-order-settings" aria-labelledby={columnOrderTitleId}>
                <h3 id={columnOrderTitleId}>Column order</h3>
                <p>Left to right. Changes save immediately.</p>
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
                {newColumn ? (
                  <div className="inline-column-editor">
                    <label className="field">
                      New column name
                      <input
                        value={newColumn.title}
                        maxLength={LIMITS.title}
                        onChange={(event) =>
                          setNewColumn({ ...newColumn, title: event.target.value })
                        }
                      />
                    </label>
                    <label className="field">
                      New column color
                      <select
                        value={newColumn.color}
                        onChange={(event) =>
                          setNewColumn({
                            ...newColumn,
                            color: event.target.value as Column['color'],
                          })
                        }
                      >
                        {COLUMN_COLORS.map((color) => (
                          <option key={color} value={color}>
                            {color}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="inline-column-actions">
                      <button
                        type="button"
                        className="button secondary"
                        disabled={locked || currentColumns.length >= LIMITS.columns}
                        onClick={() => void createColumn()}
                      >
                        Create column
                      </button>
                      <button
                        type="button"
                        className="button quiet"
                        disabled={busy}
                        onClick={() => setNewColumn(undefined)}
                      >
                        Cancel new column
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={locked || currentColumns.length >= LIMITS.columns}
                    onClick={() =>
                      setNewColumn({ id: crypto.randomUUID(), title: '', color: 'blue' })
                    }
                  >
                    <Plus size={16} /> Add column
                  </button>
                )}
              </section>
            </div>
            <div className="settings-column">
              <CardFieldsSettings
                settings={fields}
                savedIds={
                  new Set(cardFields(currentBoard ?? board).custom.map((field) => field.id))
                }
                locked={locked}
                onChange={setFields}
              />
              <section className="archive-settings" aria-labelledby={archiveTitleId}>
                <h3 id={archiveTitleId}>
                  Archived cards <span>({archivedCards.length})</span>
                </h3>
                <p>Find, restore or permanently delete archived cards.</p>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => {
                    setLocalError('');
                    setShowArchive(true);
                  }}
                >
                  <Archive size={16} /> Browse archive
                </button>
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
            </div>
          </div>
        </EditorForm>
      )}
    </Dialog>
  );
}

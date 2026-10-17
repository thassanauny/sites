import { sameShape, useRecoveryDraft } from '../../../application/useRecoveryDraft';
import { useState, type FormEvent } from 'react';
import { Dialog } from '../../../ui/Dialog';
import { message } from '../../../ui/message';
import { DescriptionField, DiscardDraft, EditorForm, TitleField, useDraftClose } from './shared';

export function CreateBoardDialog({
  busy,
  offline,
  serverError,
  onClose: closeModal,
  onCreate,
}: {
  busy: boolean;
  offline: boolean;
  serverError: string;
  onClose: () => void;
  onCreate: (id: string, title: string, description: string) => Promise<boolean>;
}) {
  const sample = { title: '', description: '', createId: crypto.randomUUID() };
  const recovery = useRecoveryDraft('new-board', sample, (value): value is typeof sample =>
    sameShape(sample, value),
  );
  const { title, description, createId } = recovery.value;
  const setTitle = (title: string) => recovery.setValue((current) => ({ ...current, title }));
  const setDescription = (description: string) =>
    recovery.setValue((current) => ({ ...current, description }));
  const [localError, setLocalError] = useState('');
  const discard = useDraftClose(title.trim() !== '' || description.trim() !== '', closeModal);
  const locked = busy || offline;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (locked) return;
    try {
      if (await onCreate(createId, title.trim(), description.trim())) {
        recovery.clear();
        closeModal();
      }
    } catch (error) {
      setLocalError(message(error));
    }
  }
  return (
    <Dialog
      title={discard.confirming ? 'Discard this draft?' : 'Start a project.'}
      busy={busy}
      onClose={discard.confirming ? discard.keepEditing : discard.close}
    >
      {discard.confirming ? (
        <DiscardDraft
          busy={busy}
          removed={false}
          onKeep={discard.keepEditing}
          onDiscard={() => {
            if (recovery.clear()) closeModal();
          }}
        />
      ) : (
        <EditorForm
          localError={localError || recovery.error}
          serverError={serverError}
          offline={offline}
          busy={busy}
          locked={locked}
          onCancel={discard.close}
          submitLabel="Create board"
          onSubmit={(event) => void submit(event)}
        >
          {recovery.recovered && (
            <p className="soft-note">
              Recovered unsaved draft from this device. Review it before saving.
            </p>
          )}
          <TitleField
            label="Board name"
            value={title}
            placeholder="e.g. A very good week"
            onChange={setTitle}
          />
          <DescriptionField rows={3} value={description} onChange={setDescription} />
          <p className="soft-note">
            Your board starts with To do, In progress, and Done. Make it your own.
          </p>
        </EditorForm>
      )}
    </Dialog>
  );
}

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
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [localError, setLocalError] = useState('');
  // The ID is kept until success so a lost response can be retried safely.
  const [createId] = useState(() => crypto.randomUUID());
  const discard = useDraftClose(title.trim() !== '' || description.trim() !== '', closeModal);
  const locked = busy || offline;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (locked) return;
    try {
      if (await onCreate(createId, title.trim(), description.trim())) closeModal();
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
          onDiscard={closeModal}
        />
      ) : (
        <EditorForm
          localError={localError}
          serverError={serverError}
          offline={offline}
          busy={busy}
          locked={locked}
          onCancel={discard.close}
          submitLabel="Create board"
          onSubmit={(event) => void submit(event)}
        >
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

import { useState, type FormEvent } from 'react';
import { readInviteCode } from '../../../domain/boards/board';
import { Dialog } from '../../../ui/Dialog';
import { message } from '../../../ui/message';
import { EditorForm } from './shared';

export function JoinBoardDialog({
  initialCode,
  busy,
  offline,
  serverError,
  onClose,
  onJoin,
}: {
  initialCode: string;
  busy: boolean;
  offline: boolean;
  serverError: string;
  onClose: () => void;
  onJoin: (code: string) => Promise<boolean>;
}) {
  const [code, setCode] = useState(initialCode);
  const [localError, setLocalError] = useState('');
  const locked = busy || offline;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setLocalError('');
    if (locked) return;
    try {
      if (await onJoin(readInviteCode(code))) onClose();
    } catch (error) {
      setLocalError(message(error));
    }
  }
  return (
    <Dialog title="Join a board." busy={busy} onClose={onClose}>
      <EditorForm
        localError={localError}
        serverError={serverError}
        offline={offline}
        busy={busy}
        locked={locked}
        onCancel={onClose}
        submitLabel="Join board"
        submitIcon="arrow"
        onSubmit={(event) => void submit(event)}
      >
        <p className="dialog-intro">
          Paste the invitation code or link you received. No account needed.
        </p>
        <label className="field">
          Invitation code or link
          <input
            autoFocus
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Paste your invitation here"
            autoComplete="off"
          />
        </label>
      </EditorForm>
    </Dialog>
  );
}

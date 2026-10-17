import { Copy, Link } from 'lucide-react';
import type { Board } from '../../../domain/boards/types';
import { Dialog } from '../../../ui/Dialog';
import { CopyField, FormError, useDialogMessages } from './shared';

export function ShareDialog({
  board,
  busy,
  onClose,
  onNotice,
}: {
  board: Board;
  busy: boolean;
  onClose: () => void;
  onNotice: (text: string) => void;
}) {
  const { localError, copied, copy } = useDialogMessages(onNotice);
  const url = `${window.location.href.split('#')[0]}#board/${board.invite_code}`;
  return (
    <Dialog title="Invite a few people." busy={busy} onClose={onClose}>
      <p className="dialog-intro">
        Invite people to <strong>{board.title}</strong>. Anyone with this code can view and edit the
        board.
      </p>
      <CopyField
        code={board.invite_code}
        copied={copied}
        onCopy={() => void copy(board.invite_code, 'Code')}
      />
      <label className="field">
        Invitation link
        <input readOnly value={url} onFocus={(event) => event.target.select()} />
      </label>
      {localError && <FormError>{localError}</FormError>}
      <div className="invite-note">
        <Link size={16} />
        <span>Save the code to find your board again on any device.</span>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={() => void copy(url, 'Link')}>
          <Copy size={16} />
          Copy invite link
        </button>
      </div>
    </Dialog>
  );
}

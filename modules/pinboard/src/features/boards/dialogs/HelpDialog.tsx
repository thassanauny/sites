import { Check } from 'lucide-react';
import { Dialog } from '../../../ui/Dialog';

export function HelpDialog({ busy, onClose }: { busy: boolean; onClose: () => void }) {
  return (
    <Dialog title="A place for your projects." busy={busy} onClose={onClose}>
      <div className="help-content">
        <p>
          Create a board for your project. Work on your own, or use
          <strong> Invite people</strong> to share its code. Anyone with the code can join and edit.
        </p>
        <p>
          Drag cards above or below another card to change their order, or between columns. On a
          phone or with a keyboard, use a card’s up/down arrows to reorder it and its menu to change
          columns. Add columns and change their order in Board settings; the arrows save each move.
        </p>
        <p>
          Boards sync every five seconds. When two people edit the same field, the last change
          accepted by the server wins. Separate changes are kept.
        </p>
        <p>
          Open a board online once to edit it offline. Saved changes sync automatically when
          connected. Keep your invite codes: you can rejoin if you clear browser data or switch
          devices. Unsaved editor drafts have local recovery; reopen the same editor and Save to
          publish a recovered draft.
        </p>
        <p>
          Use Board settings to remove a board from this device. Everyone else keeps access. Join
          again with its code, or confirm Join from its invitation link to restore it on Home.
        </p>
      </div>
      <div className="dialog-actions">
        <button type="button" className="button primary" onClick={onClose}>
          Got it <Check size={16} />
        </button>
      </div>
    </Dialog>
  );
}

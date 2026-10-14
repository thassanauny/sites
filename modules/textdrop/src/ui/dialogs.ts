import type { ShellElements } from './shell';

export type DialogKind = 'create' | 'join' | 'invite' | 'settings' | 'remove' | 'rename';

const TITLES: Record<DialogKind, string> = {
  create: 'Create a snippet',
  join: 'Open a snippet',
  invite: 'Invite to snippet',
  settings: 'Snippet settings',
  rename: 'Name this snippet',
  remove: 'Remove from this device?',
};

export interface DialogView {
  kind: DialogKind;
  /** The snippet the dialog is about: the one being invited to, named or removed. */
  code: string;
  /** An error the dialog holds itself; it comes before anything about opening a snippet. */
  error: string;
  /** The open snippet, whose unsaved text and save phase decide what Remove must warn about. */
  page: { code: string } | null;
  dirty: boolean;
  phase: 'home' | 'opening' | 'ready' | 'saving';
  /** The session's error, shown by Create and Open while a snippet opens. */
  sessionError: string;
  /** The session's error is a damaged saved browser session, so the dialog offers "Start a new session". */
  sessionDamaged: boolean;
  online: boolean;
  configured: boolean;
}

/** Shows the panel for the open dialog and hides the others. */
export function renderDialog(ui: ShellElements, view: DialogView): void {
  const { kind, code, page, dirty, phase } = view;
  ui.dialogTitle.textContent = TITLES[kind];
  ui.createForm.hidden = kind !== 'create';
  ui.joinForm.hidden = kind !== 'join';
  ui.invitePanel.hidden = kind !== 'invite';
  ui.settingsPanel.hidden = kind !== 'settings';
  ui.renameForm.hidden = kind !== 'rename';
  ui.removeForm.hidden = kind !== 'remove';
  ui.inviteCode.value = code;
  ui.removeCode.value = code;
  const removingCurrent = page?.code === code;
  ui.removeUnsaved.hidden = !removingCurrent || !dirty;
  const saving = removingCurrent && phase === 'saving';
  ui.removeSaving.hidden = !saving;
  ui.removeConfirm.disabled = saving || (removingCurrent && dirty && !ui.removeDiscard.checked);
  const opening = kind === 'create' || kind === 'join';
  const message =
    view.error || (opening ? view.sessionError || (!view.configured ? 'Sharing is unavailable. Please try again later.' : !view.online ? 'Reconnect to create or open a snippet.' : '') : '');
  ui.dialogError.textContent = message;
  ui.dialogError.hidden = !message;
  ui.dialogNewSession.hidden = !(opening && view.sessionDamaged && !view.error && message === view.sessionError);
}

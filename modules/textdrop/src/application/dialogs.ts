import { snippetAction } from '../ui/deviceList';
import { renderDialog, type DialogKind, type DialogView } from '../ui/dialogs';
import type { ShellElements } from '../ui/shell';
import type { PageSession } from './PageSession';
import { readRoute } from './routes';

export interface DialogHost {
  ui: ShellElements;
  root: HTMLElement;
  session: PageSession;
  /** The name saved on this device for a snippet, to prefill the rename field. */
  nameOf(code: string): string;
  /** Redraws the page after the dialog changed. */
  render(): void;
  /** Forgets a notice that was showing before the dialog opened. */
  clearNotice(): void;
  /** Puts Home in the address bar when an invitation dialog is dismissed. */
  showHomeAddress(): void;
}

/** The dialog on top of the page: which one is open, what it is about, its error and where focus returns. */
export class DialogController {
  kind: DialogKind | null = null;
  /** The snippet the dialog is about: the one being invited to, named or removed. */
  code = '';
  error = '';
  private copies = 0;
  private returnFocus: HTMLElement | null = null;
  private host: DialogHost;

  constructor(host: DialogHost) {
    this.host = host;
  }

  /** Create and Open wait for the session while a snippet opens. */
  get opening(): boolean {
    return this.kind === 'create' || this.kind === 'join';
  }

  /** Starts a clipboard copy. A copy that finishes after another dialog opened or closed must not report. */
  startCopy(): number {
    return ++this.copies;
  }

  isCurrentCopy(copy: number): boolean {
    return copy === this.copies;
  }

  show(kind: DialogKind, code = this.host.session.state.page?.code ?? ''): void {
    const { ui } = this.host;
    if (kind !== 'create' && kind !== 'join' && !code) return;
    ++this.copies;
    if (!ui.dialog.open) this.returnFocus = kind === 'create' ? ui.create : kind === 'join' ? ui.join : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    this.kind = kind;
    this.code = code;
    this.error = '';
    this.host.clearNotice();
    ui.removeDiscard.checked = false;
    if (kind === 'rename') ui.snippetNameInput.value = this.host.nameOf(code);
    this.host.render();
    if (!ui.dialog.open) ui.dialog.showModal();
    (kind === 'create'
      ? ui.createConfirm
      : kind === 'join'
        ? ui.joinCode
        : kind === 'invite'
          ? ui.inviteCode
          : kind === 'remove'
            ? ui.removeCode
            : kind === 'rename'
              ? ui.snippetNameInput
              : ui.settingsRename
    ).focus();
  }

  close(force = false, restoreFocus = true): void {
    const { ui, root, session } = this.host;
    const opening = this.opening;
    if (!force && opening && session.state.phase === 'opening') return;
    if (!force && this.kind === 'join' && readRoute(location.hash).kind === 'join') this.host.showHomeAddress();
    ++this.copies;
    this.kind = null;
    this.error = '';
    ui.dialog.close();
    if (!force && opening && !session.state.page) session.home();
    if (!restoreFocus) return;
    const target = this.returnFocus;
    if (target?.isConnected) target.focus();
    else {
      const replacement = [...root.querySelectorAll<HTMLElement>(`.${snippetAction(target)}`)].find(item => item.dataset.code === target?.dataset.code);
      const fallback = ui.home.hidden ? ui.settings : ui.deviceHeading;
      (replacement ?? fallback).focus();
    }
  }

  /** Draws the open dialog's panel; the caller says what the page is doing. */
  render(view: Omit<DialogView, 'kind' | 'code' | 'error'>): void {
    if (this.kind) renderDialog(this.host.ui, { ...view, kind: this.kind, code: this.code, error: this.error });
  }
}

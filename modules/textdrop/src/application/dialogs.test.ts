// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { renderDeviceList } from '../ui/deviceList';
import { shell, shellElements } from '../ui/shell';
import { DialogController } from './dialogs';
import type { PageSession } from './PageSession';

const code = 'a'.repeat(32);
let ui: ReturnType<typeof shellElements>;
let root: HTMLDivElement;
let state: { phase: string; page: { code: string } | null };
let home: Mock<() => void>;
let render: Mock<() => void>;
let clearNotice: Mock<() => void>;
let showHomeAddress: Mock<() => void>;
let dialogs: DialogController;

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  document.body.innerHTML = '<div id="app"></div>';
  root = document.querySelector<HTMLDivElement>('#app')!;
  root.innerHTML = shell();
  ui = shellElements(root);
  state = { phase: 'home', page: null };
  home = vi.fn<() => void>();
  render = vi.fn<() => void>();
  clearNotice = vi.fn<() => void>();
  showHomeAddress = vi.fn<() => void>();
  dialogs = new DialogController({
    ui,
    root,
    session: { state, home } as unknown as PageSession,
    nameOf: snippet => (snippet === code ? 'Travel notes' : ''),
    render,
    clearNotice,
    showHomeAddress,
  });
  history.replaceState(null, '', '/textdrop/#/');
});
afterEach(() => {
  document.body.innerHTML = '';
});

describe('dialog controller', () => {
  it('opens a dialog for a snippet, clears old notices, draws once and focuses the first control', () => {
    ui.create.focus();
    dialogs.show('create');
    expect(dialogs.kind).toBe('create');
    expect(dialogs.opening).toBe(true);
    expect(ui.dialog.open).toBe(true);
    expect(clearNotice).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(ui.createConfirm);
    dialogs.close();
    expect(ui.dialog.open).toBe(false);
    expect(dialogs.kind).toBeNull();
    expect(document.activeElement).toBe(ui.create);
  });

  it('needs a snippet code for every dialog except Create and Open', () => {
    dialogs.show('invite');
    dialogs.show('rename');
    dialogs.show('remove');
    dialogs.show('settings');
    expect(dialogs.kind).toBeNull();
    expect(ui.dialog.open).toBe(false);
    state.page = { code };
    dialogs.show('invite');
    expect([dialogs.kind, dialogs.code]).toEqual(['invite', code]);
    expect(document.activeElement).toBe(ui.inviteCode);
    dialogs.show('remove', 'b'.repeat(32));
    expect([dialogs.kind, dialogs.code]).toEqual(['remove', 'b'.repeat(32)]);
    expect(document.activeElement).toBe(ui.removeCode);
  });

  it('prefills the rename field with the saved name and unchecks the discard confirmation', () => {
    ui.removeDiscard.checked = true;
    dialogs.show('rename', code);
    expect(ui.snippetNameInput.value).toBe('Travel notes');
    expect(ui.removeDiscard.checked).toBe(false);
    expect(document.activeElement).toBe(ui.snippetNameInput);
    dialogs.show('rename', 'c'.repeat(32));
    expect(ui.snippetNameInput.value).toBe('');
  });

  it('returns focus to the control that opened the dialog, and keeps the first trigger when dialogs follow each other', () => {
    state.page = { code };
    ui.home.hidden = true;
    ui.settings.focus();
    dialogs.show('settings');
    expect(document.activeElement).toBe(ui.settingsRename);
    dialogs.show('rename');
    dialogs.close();
    expect(document.activeElement).toBe(ui.settings);
  });

  it('finds the replacement of a list control that was redrawn, else falls back to the list heading or the settings button', () => {
    const snippets = [{ code, openedAt: '2026-10-10T01:00:00.000Z' }];
    renderDeviceList(ui, snippets, value => `#/p/${value}`);
    root.querySelector<HTMLButtonElement>('.snippet-rename')!.focus();
    dialogs.show('rename', code);
    renderDeviceList(ui, snippets, value => `#/p/${value}`);
    dialogs.close();
    expect(document.activeElement).toBe(root.querySelector('.snippet-rename'));

    root.querySelector<HTMLAnchorElement>('.snippet-open')!.focus();
    dialogs.show('remove', code);
    renderDeviceList(ui, [], value => `#/p/${value}`);
    dialogs.close();
    expect(document.activeElement).toBe(ui.deviceHeading);

    state.page = { code };
    ui.home.hidden = true;
    ui.share.focus();
    dialogs.show('invite');
    ui.share.remove();
    dialogs.close();
    expect(document.activeElement).toBe(ui.settings);
  });

  it('refuses to close Create or Open while a snippet is opening unless forced, and does not move focus when asked not to', () => {
    dialogs.show('join');
    state.phase = 'opening';
    dialogs.close();
    expect(dialogs.kind).toBe('join');
    expect(ui.dialog.open).toBe(true);
    ui.create.focus();
    dialogs.close(true, false);
    expect(dialogs.kind).toBeNull();
    expect(ui.dialog.open).toBe(false);
    expect(document.activeElement).toBe(ui.create);
    expect(home).not.toHaveBeenCalled();
  });

  it('returns to Home when Create or Open is dismissed without a snippet, but not when one is open or the close is forced', () => {
    dialogs.show('create');
    dialogs.close();
    expect(home).toHaveBeenCalledTimes(1);
    dialogs.show('join');
    dialogs.close(true);
    expect(home).toHaveBeenCalledTimes(1);
    state.page = { code };
    dialogs.show('join');
    dialogs.close();
    expect(home).toHaveBeenCalledTimes(1);
    dialogs.show('invite');
    dialogs.close();
    expect(home).toHaveBeenCalledTimes(1);
  });

  it('puts Home in the address bar when an invitation dialog is dismissed', () => {
    history.replaceState(null, '', `/textdrop/#/p/${code}`);
    dialogs.show('join');
    dialogs.close();
    expect(showHomeAddress).toHaveBeenCalledTimes(1);
    history.replaceState(null, '', '/textdrop/#/');
    dialogs.show('join');
    dialogs.close();
    dialogs.show('join');
    dialogs.close(true);
    expect(showHomeAddress).toHaveBeenCalledTimes(1);
    history.replaceState(null, '', `/textdrop/#/p/${code}`);
    dialogs.show('join');
    dialogs.close(true);
    expect(showHomeAddress).toHaveBeenCalledTimes(1);
  });

  it('invalidates a clipboard copy when a dialog opens or closes', () => {
    const copy = dialogs.startCopy();
    expect(dialogs.isCurrentCopy(copy)).toBe(true);
    dialogs.show('create');
    expect(dialogs.isCurrentCopy(copy)).toBe(false);
    const second = dialogs.startCopy();
    dialogs.close();
    expect(dialogs.isCurrentCopy(second)).toBe(false);
    const third = dialogs.startCopy();
    expect(dialogs.isCurrentCopy(third)).toBe(true);
    expect(dialogs.isCurrentCopy(second)).toBe(false);
  });

  it('draws the open dialog with its own state and nothing when none is open', () => {
    dialogs.render({ page: null, dirty: false, phase: 'home', sessionError: '', sessionDamaged: false, online: true, configured: true });
    expect(ui.dialogTitle.textContent).toBe('');
    dialogs.show('create');
    dialogs.error = 'Create response lost';
    dialogs.render({ page: null, dirty: false, phase: 'home', sessionError: '', sessionDamaged: false, online: true, configured: true });
    expect(ui.dialogTitle.textContent).toBe('Create a snippet');
    expect(ui.dialogError.textContent).toBe('Create response lost');
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { renderDialog, type DialogKind, type DialogView } from './dialogs';
import { shell, shellElements } from './shell';

function setup() {
  const root = document.createElement('div');
  root.innerHTML = shell();
  return shellElements(root);
}
const code = 'a'.repeat(32);
const view = (changes: Partial<DialogView> = {}): DialogView => ({
  kind: 'create',
  code: '',
  error: '',
  page: null,
  dirty: false,
  phase: 'home',
  sessionError: '',
  sessionDamaged: false,
  online: true,
  configured: true,
  ...changes,
});

describe('dialog panels', () => {
  it('shows the title and only the panel of the open dialog', () => {
    const ui = setup();
    const panels = { create: ui.createForm, join: ui.joinForm, invite: ui.invitePanel, settings: ui.settingsPanel, rename: ui.renameForm, remove: ui.removeForm };
    const titles: Record<DialogKind, string> = {
      create: 'Create a snippet',
      join: 'Open a snippet',
      invite: 'Invite to snippet',
      settings: 'Snippet settings',
      rename: 'Name this snippet',
      remove: 'Remove from this device?',
    };
    for (const kind of Object.keys(panels) as DialogKind[]) {
      renderDialog(ui, view({ kind, code }));
      expect(ui.dialogTitle.textContent, kind).toBe(titles[kind]);
      for (const [other, panel] of Object.entries(panels)) expect(panel.hidden, `${kind}: ${other}`).toBe(other !== kind);
    }
  });

  it('puts the snippet code in the invitation and removal fields', () => {
    const ui = setup();
    renderDialog(ui, view({ kind: 'invite', code }));
    expect(ui.inviteCode.value).toBe(code);
    expect(ui.removeCode.value).toBe(code);
  });

  it('warns about unsaved text only when removing the open snippet, and waits for a save in progress', () => {
    const ui = setup();
    const open = { code };
    renderDialog(ui, view({ kind: 'remove', code, page: open, dirty: false, phase: 'ready' }));
    expect([ui.removeUnsaved.hidden, ui.removeSaving.hidden, ui.removeConfirm.disabled]).toEqual([true, true, false]);

    renderDialog(ui, view({ kind: 'remove', code, page: open, dirty: true, phase: 'ready' }));
    expect([ui.removeUnsaved.hidden, ui.removeSaving.hidden, ui.removeConfirm.disabled]).toEqual([false, true, true]);
    ui.removeDiscard.checked = true;
    renderDialog(ui, view({ kind: 'remove', code, page: open, dirty: true, phase: 'ready' }));
    expect(ui.removeConfirm.disabled).toBe(false);

    renderDialog(ui, view({ kind: 'remove', code, page: open, dirty: true, phase: 'saving' }));
    expect([ui.removeUnsaved.hidden, ui.removeSaving.hidden, ui.removeConfirm.disabled]).toEqual([false, false, true]);

    ui.removeDiscard.checked = false;
    renderDialog(ui, view({ kind: 'remove', code: 'b'.repeat(32), page: open, dirty: true, phase: 'saving' }));
    expect([ui.removeUnsaved.hidden, ui.removeSaving.hidden, ui.removeConfirm.disabled]).toEqual([true, true, false]);
  });

  it('shows the dialog error first and the opening problems only in Create and Open', () => {
    const ui = setup();
    renderDialog(ui, view({ kind: 'join', error: 'Check the code', sessionError: 'Offline' }));
    expect([ui.dialogError.textContent, ui.dialogError.hidden]).toEqual(['Check the code', false]);
    renderDialog(ui, view({ kind: 'join', sessionError: 'The code was not found' }));
    expect(ui.dialogError.textContent).toBe('The code was not found');
    renderDialog(ui, view({ kind: 'create', online: false }));
    expect(ui.dialogError.textContent).toBe('Reconnect to create or open a snippet.');
    renderDialog(ui, view({ kind: 'create', configured: false }));
    expect(ui.dialogError.textContent).toBe('Sharing is unavailable. Please try again later.');
    renderDialog(ui, view({ kind: 'create' }));
    expect([ui.dialogError.textContent, ui.dialogError.hidden]).toEqual(['', true]);
    renderDialog(ui, view({ kind: 'rename', sessionError: 'Not for this dialog', online: false, configured: false }));
    expect([ui.dialogError.textContent, ui.dialogError.hidden]).toEqual(['', true]);
    renderDialog(ui, view({ kind: 'rename', error: 'Could not save the name' }));
    expect(ui.dialogError.textContent).toBe('Could not save the name');
  });
});

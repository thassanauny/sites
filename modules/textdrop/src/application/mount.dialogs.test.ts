// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, second, key, pending, root, cloud, dispose, writeText, element, rows, flush, start, edit, join } from '../../tests/mountHarness';
import type { TextDropPage } from '../domain/snippets/model';
import { DEVICE_SNIPPETS_KEY, DeviceSnippets } from '../infrastructure/storage/deviceSnippets';

useMountHarness();

describe('TextDrop dialogs', () => {
  it('opens Create and Join dialogs without sending a request and restores trigger focus when cancelled', async () => {
    await start();
    const dialog = element<HTMLDialogElement>('snippet-dialog');
    element('create').focus();
    element('create').click();
    expect(dialog.open).toBe(true);
    expect(element('create-form').hidden).toBe(false);
    expect(element('join-form').hidden).toBe(true);
    expect(document.activeElement).toBe(element('create-confirm'));
    expect(cloud.createPage).not.toHaveBeenCalled();
    element('create-cancel').click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(element('create'));

    element('join').focus();
    element('join').click();
    expect(dialog.open).toBe(true);
    expect(element('create-form').hidden).toBe(true);
    expect(element('join-form').hidden).toBe(false);
    expect(document.activeElement).toBe(element('join-code'));
    expect(cloud.joinPage).not.toHaveBeenCalled();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(element('join'));
  });

  it('restores dialog focus when another tab replaces the list buttons', async () => {
    new DeviceSnippets().remember(first.code);
    await start();
    const trigger = root.querySelector<HTMLButtonElement>('.snippet-rename')!;
    trigger.focus();
    trigger.click();
    new DeviceSnippets().remember(second.code);
    window.dispatchEvent(new StorageEvent('storage', { key: key(second.code) }));
    expect(trigger.isConnected).toBe(false);
    element('rename-cancel').click();
    expect(document.activeElement).toBe(root.querySelector(`.snippet-rename[data-code="${first.code}"]`));
  });

  it('keeps a successful newer copy visible when an older copy fails later', async () => {
    await start(`#/p/${first.code}`);
    const older = pending<void>();
    const newer = pending<void>();
    writeText.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    element('share').click();
    element('invite-copy-code').click();
    element('invite-copy-link').click();
    newer.resolve();
    await flush();
    expect(element('toast').textContent).toBe('Invite link copied');
    older.reject(new Error('Late failure'));
    await flush();
    expect(element('dialog-error').hidden).toBe(true);
    expect(element('notice').hidden).toBe(true);
    expect(element('toast').textContent).toBe('Invite link copied');
  });

  it('ignores a late invite copy failure after opening a different dialog', async () => {
    await start(`#/p/${first.code}`);
    const copying = pending<void>();
    writeText.mockReturnValueOnce(copying.promise);
    element('share').click();
    element('invite-copy-code').click();
    element('dialog-close').click();
    element('settings').click();
    copying.reject(new Error('Late failure'));
    await flush();
    expect(element('dialog-title').textContent).toBe('Snippet settings');
    expect(element('dialog-error').hidden).toBe(true);
    expect(element('notice').hidden).toBe(true);
  });

  it('offers a selectable invitation code and link with clipboard failure recovery', async () => {
    await start(`#/p/${first.code}`);
    element('share').focus();
    element('share').click();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-title').textContent).toBe('Invite to snippet');
    expect(element<HTMLInputElement>('invite-code').value).toBe(first.code);
    expect(element<HTMLInputElement>('invite-code').selectionEnd).toBe(32);
    expect(element('invite-panel').textContent).toContain('Share it with people you trust');
    writeText.mockRejectedValueOnce(new Error('Denied'));
    element('invite-copy-code').click();
    await flush();
    expect(element('dialog-error').hidden).toBe(false);
    expect(element<HTMLInputElement>('invite-code').value).toBe(first.code);
    element('invite-copy-code').click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(first.code);
    expect(element('dialog-error').hidden).toBe(true);
    element('invite-copy-link').click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith(`http://localhost/textdrop/#/p/${first.code}`);
    element('dialog-close').click();
    expect(document.activeElement).toBe(element('share'));
  });

  it('keeps a dialog open on its padding, closes from the backdrop or Escape, and restores keyboard focus', async () => {
    await start(`#/p/${first.code}`);
    const dialog = element<HTMLDialogElement>('snippet-dialog');
    const trigger = element('settings');
    const draft = 'Keep this dialog draft';
    edit(draft);
    trigger.focus();
    trigger.click();
    vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 100, right: 500, bottom: 400 } as DOMRect);
    dialog.dispatchEvent(new MouseEvent('click', { clientX: 110, clientY: 110, bubbles: true }));
    expect(dialog.open).toBe(true);
    dialog.dispatchEvent(new MouseEvent('click', { clientX: 90, clientY: 110, bubbles: true }));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(element<HTMLTextAreaElement>('editor').value).toBe(draft);

    trigger.click();
    element('settings-remove').click();
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(trigger);
    expect(rows()).toEqual([first.code]);
    expect(element<HTMLTextAreaElement>('editor').value).toBe(draft);
    expect(cloud.savePage).not.toHaveBeenCalled();
  });

  it('keeps removed snippets hidden on Home and restores them to Home after a confirmed Open', async () => {
    await start(`#/p/${first.code}`);
    element('settings').click();
    expect(element('dialog-title').textContent).toBe('Snippet settings');
    element('settings-remove').click();
    expect(element('dialog-title').textContent).toBe('Remove from this device?');
    expect(rows()).toEqual([first.code]);
    expect(element<HTMLInputElement>('remove-code').value).toBe(first.code);
    element('remove-cancel').click();
    expect(rows()).toEqual([first.code]);
    element('settings').click();
    element('settings-remove').click();
    window.dispatchEvent(new Event('offline'));
    element('remove-confirm').click();
    expect(rows()).toEqual([]);
    expect(element('home').hidden).toBe(false);
    expect(location.hash).toBe('#/');
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(cloud.createPage).not.toHaveBeenCalled();
    vi.mocked(cloud.joinPage).mockClear();
    dispose!();
    await start('#/');
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(rows()).toEqual([]);
    dispose!();
    await start(`#/p/${first.code}`);
    expect(cloud.joinPage).not.toHaveBeenCalled();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    await join(first.code);
    expect(cloud.joinPage).toHaveBeenCalledExactlyOnceWith(first.code);
    expect(rows()).toEqual([first.code]);
    expect(location.hash).toBe('#/');
    expect(element('home').hidden).toBe(false);
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(false);
  });

  it('requires an explicit choice to discard unsaved text and preserves it when local removal fails', async () => {
    await start(`#/p/${first.code}`);
    edit('Only in this open page');
    element('settings').click();
    element('settings-remove').click();
    expect(element('remove-unsaved').hidden).toBe(false);
    expect(element<HTMLButtonElement>('remove-confirm').disabled).toBe(true);
    element('remove-confirm').click();
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Only in this open page');
    element('remove-copy-text').click();
    await flush();
    expect(writeText).toHaveBeenLastCalledWith('Only in this open page');
    element<HTMLInputElement>('remove-discard').click();
    expect(element<HTMLButtonElement>('remove-confirm').disabled).toBe(false);
    const saving = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    element('remove-confirm').click();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-error').textContent).toContain('Could not remove');
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Only in this open page');
    expect(rows()).toEqual([first.code]);
    saving.mockRestore();
    element('remove-confirm').click();
    expect(element('home').hidden).toBe(false);
    expect(rows()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(cloud.savePage).not.toHaveBeenCalled();
  });

  it('waits for an in-flight save before allowing removal', async () => {
    const saving = pending<TextDropPage>();
    vi.mocked(cloud.savePage).mockReturnValueOnce(saving.promise);
    await start(`#/p/${first.code}`);
    edit('Saving this text');
    await vi.advanceTimersByTimeAsync(650);
    element('settings').click();
    element('settings-remove').click();
    element<HTMLInputElement>('remove-discard').click();
    expect(element('remove-saving').hidden).toBe(false);
    expect(element<HTMLButtonElement>('remove-confirm').disabled).toBe(true);
    saving.resolve({ ...first, text: 'Saving this text', version: 2 });
    await flush();
    expect(element('remove-unsaved').hidden).toBe(true);
    expect(element<HTMLButtonElement>('remove-confirm').disabled).toBe(false);
    element('remove-confirm').click();
    expect(rows()).toEqual([]);
    expect(cloud.savePage).toHaveBeenCalledTimes(1);
  });

  it('preserves a dirty editor and confirmation when browser storage cannot be read during removal', async () => {
    await start(`#/p/${first.code}`);
    edit('Recover this unsaved text');
    window.dispatchEvent(new Event('offline'));
    element('settings').click();
    element('settings-remove').click();
    element<HTMLInputElement>('remove-discard').click();
    const reads = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Denied');
    });
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    element('remove-confirm').click();
    expect(writes).not.toHaveBeenCalled();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-error').textContent).toContain('Could not read snippets saved on this device');
    expect(element('workspace').hidden).toBe(false);
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Recover this unsaved text');
    expect(rows()).toEqual([first.code]);
    reads.mockRestore();
    expect(new DeviceSnippets().isRemoved(first.code)).toBe(false);
    expect(cloud.savePage).not.toHaveBeenCalled();
  });

  it('keeps a failed name edit available for retry and allows naming offline without changing shared text', async () => {
    await start(`#/p/${first.code}`);
    edit('Keep this unsaved text');
    window.dispatchEvent(new Event('offline'));
    element('settings').focus();
    element('settings').click();
    element('settings-rename').click();
    element<HTMLInputElement>('snippet-name-input').value = 'My notes';
    const writes = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Full');
    });
    element('rename-confirm').click();
    await flush();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-error').textContent).toContain('could not save its local copy');
    expect(element<HTMLInputElement>('snippet-name-input').value).toBe('My notes');
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this unsaved text');
    expect(element('page-name').textContent).toBe('Untitled snippet');
    expect(document.title).toBe('Untitled snippet — TextDrop');
    writes.mockRestore();
    element('rename-confirm').click();
    await flush();
    expect(element('page-name').textContent).toBe('My notes');
    expect(document.title).toBe('My notes — TextDrop');
    expect(document.activeElement).toBe(element('settings'));
    expect(cloud.savePage).not.toHaveBeenCalled();
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep this unsaved text');
  });

  it('cancels names without writing and handles cross-tab names and removal while the dialog is open', async () => {
    new DeviceSnippets().remember(first.code);
    await start();
    root.querySelector<HTMLButtonElement>('.snippet-rename')!.focus();
    root.querySelector<HTMLButtonElement>('.snippet-rename')!.click();
    element<HTMLInputElement>('snippet-name-input').value = 'Cancelled name';
    element('rename-cancel').click();
    expect(new DeviceSnippets().list()[0]!.name).toBeUndefined();
    expect(document.activeElement).toBe(root.querySelector('.snippet-rename'));
    new DeviceSnippets().rename(first.code, 'From another tab');
    window.dispatchEvent(new StorageEvent('storage', { key: `${DEVICE_SNIPPETS_KEY}:name:${first.code}` }));
    expect(root.querySelector('.snippet-name')!.textContent).toBe('From another tab');
    expect(document.activeElement).toBe(root.querySelector('.snippet-rename'));
    root.querySelector<HTMLButtonElement>('.snippet-rename')!.click();
    element<HTMLInputElement>('snippet-name-input').value = 'Keep my input';
    new DeviceSnippets().remove(first.code);
    window.dispatchEvent(new StorageEvent('storage', { key: `${DEVICE_SNIPPETS_KEY}:removed:${first.code}` }));
    expect(element<HTMLInputElement>('snippet-name-input').value).toBe('Keep my input');
    element('rename-confirm').click();
    await flush();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element('dialog-error').hidden).toBe(false);
    expect(rows()).toEqual([]);
    expect(new DeviceSnippets().isRemoved(first.code)).toBe(true);
    element('rename-cancel').click();
    expect(document.activeElement).toBe(element('device-heading'));
  });
});

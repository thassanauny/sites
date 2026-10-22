// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/textdrop/#/"}
import { describe, expect, it, vi } from 'vitest';
import { useMountHarness, first, root, cloud, element, flush, start, edit } from '../../tests/mountHarness';
import { DeviceSnippets, DEVICE_SNIPPETS_KEY } from '../infrastructure/storage/deviceSnippets';
useMountHarness();
describe('shared snippet names', () => {
  it('keeps cached Home names while retrying a failed read before the healthy live reconciliation interval', async () => {
    const history = new DeviceSnippets();
    history.remember(first.code);
    history.sharedName(first.code, 'Cached name', 1);
    let health!: (healthy: boolean) => void;
    cloud.subscribeChanges = vi.fn((_changed, reportHealth) => {
      health = reportHealth!;
      return () => health(false);
    });
    cloud.listNames = vi
      .fn()
      .mockResolvedValueOnce([{ code: first.code, name: 'Cached name', version: 1 }])
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValue([{ code: first.code, name: 'Updated name', version: 2 }]);
    await start();
    health(true);
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(cloud.listNames).toHaveBeenCalledTimes(2);
    expect(element('connection-label').textContent).toBe('Needs attention');
    expect(root.querySelector('.snippet-name')?.textContent).toBe('Cached name');
    await vi.advanceTimersByTimeAsync(5998);
    expect(cloud.listNames).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.listNames).toHaveBeenCalledTimes(3);
    expect(root.querySelector('.snippet-name')?.textContent).toBe('Updated name');
    expect(element('connection-label').textContent).toBe('Connected');
    await vi.advanceTimersByTimeAsync(59_999);
    expect(cloud.listNames).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(cloud.listNames).toHaveBeenCalledTimes(4);
  });
  it('renames from the title, preserves text drafts and restores focus after cancelling', async () => {
    await start(`#/p/${first.code}`);
    edit('Keep my text draft');
    element('rename-page').focus();
    element('rename-page').click();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(document.activeElement).toBe(element('snippet-name-input'));
    element('rename-cancel').click();
    expect(document.activeElement).toBe(element('rename-page'));
    element('rename-page').click();
    element<HTMLInputElement>('snippet-name-input').value = 'Team notes';
    element('rename-confirm').click();
    await flush();
    expect(cloud.renamePage).toHaveBeenLastCalledWith(first.id, 'Team notes');
    expect(element('page-name').textContent).toBe('Team notes');
    expect(document.activeElement).toBe(element('rename-page'));
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Keep my text draft');
    expect(cloud.savePage).not.toHaveBeenCalled();
  });
  it('shows shared names in the editor and list without overwriting an existing shared name', async () => {
    const history = new DeviceSnippets();
    history.remember(first.code);
    history.sharedName(first.code, 'Old private label', 1);
    vi.mocked(cloud.joinPage).mockResolvedValueOnce({ ...first, name: 'Team notes', version: 2 });
    await start(`#/p/${first.code}`);
    expect(element('page-name').textContent).toBe('Team notes');
    expect(document.title).toBe('Team notes · TextDrop');
    expect(history.list()[0]?.name).toBe('Team notes');
    expect(localStorage.getItem(`${DEVICE_SNIPPETS_KEY}:name:${first.code}`)).toContain('Team notes');
    expect(cloud.renamePage).not.toHaveBeenCalled();
  });
  it('retains failed explicit name edits and text drafts', async () => {
    const history = new DeviceSnippets();
    history.remember(first.code);
    history.sharedName(first.code, 'Shared label', 1);
    vi.mocked(cloud.joinPage).mockResolvedValueOnce({ ...first, name: 'Shared label' });
    await start(`#/p/${first.code}`);
    await flush();
    expect(cloud.renamePage).not.toHaveBeenCalled();
    expect(new DeviceSnippets().list()[0]?.name).toBe('Shared label');
    edit('Unsaved text');
    element('settings').click();
    element('settings-rename').click();
    expect(element<HTMLInputElement>('snippet-name-input').value).toBe('Shared label');
    element<HTMLInputElement>('snippet-name-input').value = 'Updated shared name';
    vi.mocked(cloud.renamePage!).mockRejectedValueOnce(new Error('Could not connect'));
    element('rename-confirm').click();
    await flush();
    expect(element<HTMLDialogElement>('snippet-dialog').open).toBe(true);
    expect(element<HTMLInputElement>('snippet-name-input').value).toBe('Updated shared name');
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Unsaved text');
    expect(element('page-name').textContent).toBe('Shared label');
    element('rename-confirm').click();
    await flush();
    expect(cloud.renamePage).toHaveBeenLastCalledWith(first.id, 'Updated shared name');
    expect(element('page-name').textContent).toBe('Updated shared name');
    expect(element<HTMLTextAreaElement>('editor').value).toBe('Unsaved text');
    expect(cloud.savePage).not.toHaveBeenCalled();
  });
  it('refreshes homepage names without restoring removed snippets and ignores stale labels', async () => {
    const history = new DeviceSnippets();
    history.remember(first.code);
    history.sharedName(first.code, 'Latest name', 3);
    cloud.listNames = vi.fn(async () => [{ code: first.code, name: 'Older name', version: 2 }]);
    await start();
    await flush();
    expect(root.querySelector('.snippet-name')?.textContent).toBe('Latest name');
    history.remove(first.code);
    window.dispatchEvent(new StorageEvent('storage', { key: `${DEVICE_SNIPPETS_KEY}:removed:${first.code}` }));
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(root.querySelector('.device-row')).toBeNull();
    expect(history.isRemoved(first.code)).toBe(true);
  });
});

it('reports failed shared-name refreshes and clears that status after reconnecting', async () => {
  new DeviceSnippets().remember(first.code);
  cloud.listNames = vi.fn().mockRejectedValueOnce(new Error('TextDrop needs a database update.'));
  await start();
  await flush();
  expect(element('connection-label').textContent).toBe('Needs attention');
  expect(element('notice-message').textContent).toContain('database update');
  vi.mocked(cloud.listNames!).mockResolvedValueOnce([{ code: first.code, name: null, version: 1 }]);
  window.dispatchEvent(new Event('focus'));
  await flush();
  expect(element('connection-label').textContent).toBe('Connected');
  expect(element('notice').hidden).toBe(true);
});
